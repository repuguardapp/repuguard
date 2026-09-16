import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A URL that came from an RSS feed must not be able to point inward.
 *
 * The legal-watch extractor fetches `primary_url`, which is whatever
 * string the feed's operator put in a `<link>`. Ours are regulators',
 * but a feed is a file on someone else's server and the items inside it
 * are not ours. What comes back is fed to a model and can end up on a
 * published page, so a successful SSRF here is also an exfiltration
 * channel.
 */

vi.mock('server-only', () => ({}));

let resolved: { address: string; family: number }[];
let fetched: string[];
let responses: Response[];

function install() {
  vi.doMock('node:dns/promises', () => ({
    lookup: async () => resolved
  }));
}

async function load() {
  install();
  return import('@/lib/safe-fetch');
}

beforeEach(() => {
  vi.resetModules();
  resolved = [{ address: '93.184.216.34', family: 4 }];
  fetched = [];
  responses = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(String(url));
    return responses.shift() ?? new Response('ok', { status: 200 });
  });
});

describe('what it refuses outright', () => {
  it('refuses anything that is not https', async () => {
    const { fetchExternal } = await load();
    for (const url of ['http://example.org/a', 'file:///etc/passwd', 'gopher://x/1']) {
      await expect(fetchExternal(url), url).rejects.toThrow(/unfetchable/);
    }
    expect(fetched).toEqual([]);
  });

  it('refuses a public name that resolves to loopback', async () => {
    // localtest.me and a thousand others answer 127.0.0.1. Matching on
    // the hostname would pass every one of them, which is why the check
    // resolves instead.
    resolved = [{ address: '127.0.0.1', family: 4 }];
    const { fetchExternal } = await load();
    await expect(fetchExternal('https://localtest.me/x')).rejects.toThrow(/127\.0\.0\.1/);
    expect(fetched).toEqual([]);
  });

  it('refuses the cloud metadata address', async () => {
    resolved = [{ address: '169.254.169.254', family: 4 }];
    const { fetchExternal } = await load();
    await expect(fetchExternal('https://metadata.test/')).rejects.toThrow(/unfetchable/);
  });

  it('refuses every private range, not only the famous one', async () => {
    const { fetchExternal } = await load();
    for (const address of ['10.0.0.5', '172.16.9.9', '192.168.1.1', '100.64.0.1', '0.0.0.0']) {
      resolved = [{ address, family: 4 }];
      await expect(fetchExternal('https://x.test/'), address).rejects.toThrow(/unfetchable/);
    }
  });

  it('refuses IPv6 loopback and an IPv4-mapped one', async () => {
    const { fetchExternal } = await load();
    for (const address of ['::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) {
      resolved = [{ address, family: 6 }];
      await expect(fetchExternal('https://x.test/'), address).rejects.toThrow(/unfetchable/);
    }
  });

  it('refuses when ANY answer is private, not only the first', async () => {
    // A hostile DNS answer can put a public address first and the real
    // target second, and Node may use either.
    resolved = [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ];
    const { fetchExternal } = await load();
    await expect(fetchExternal('https://x.test/')).rejects.toThrow(/unfetchable/);
  });
});

describe('redirects are the evasion, so each hop is checked', () => {
  it('re-checks the destination of a redirect', async () => {
    // A permitted host answering 302 to the metadata address defeats
    // any check performed only on the URL we started with.
    responses = [
      new Response(null, { status: 302, headers: { location: 'https://internal.test/' } })
    ];
    const { fetchExternal } = await load();

    let call = 0;
    vi.doMock('node:dns/promises', () => ({
      lookup: async () =>
        call++ === 0
          ? [{ address: '93.184.216.34', family: 4 }]
          : [{ address: '169.254.169.254', family: 4 }]
    }));
    vi.resetModules();
    const { fetchExternal: guarded } = await import('@/lib/safe-fetch');
    await expect(guarded('https://good.test/')).rejects.toThrow(/unfetchable/);
  });

  it('follows a permitted redirect and returns the final response', async () => {
    responses = [
      new Response(null, { status: 301, headers: { location: '/moved' } }),
      new Response('body', { status: 200 })
    ];
    const { fetchExternal } = await load();
    const res = await fetchExternal('https://good.test/start');

    expect(res.status).toBe(200);
    expect(fetched).toEqual(['https://good.test/start', 'https://good.test/moved']);
  });

  it('gives up rather than looping for ever', async () => {
    responses = Array.from(
      { length: 6 },
      () => new Response(null, { status: 302, headers: { location: 'https://good.test/next' } })
    );
    const { fetchExternal } = await load();
    await expect(fetchExternal('https://good.test/')).rejects.toThrow(/redirects/);
  });

  it('never lets the platform follow a redirect for us', async () => {
    const { fetchExternal } = await load();
    const seen: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      seen.push(init);
      return new Response('ok', { status: 200 });
    });
    await fetchExternal('https://good.test/');
    expect(seen[0]?.redirect).toBe('manual');
  });
});
