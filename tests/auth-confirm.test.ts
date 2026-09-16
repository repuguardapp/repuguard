import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A GET must not create a session.
 *
 * Corporate mail security products — Defender Safe Links, Proofpoint
 * URL Defense, Mimecast — fetch every URL in an inbound message before
 * the recipient sees it. While the callback signed people in on a GET,
 * the scanner spent the one-time token on arrival and the human who
 * clicked later was told their link had expired. Of 345 accounts, 46
 * confirmed and all 46 "signed in", yet four organisations exist: 42
 * sessions created and used for nothing.
 *
 * Every test here defends one half of the asymmetry the fix rests on —
 * scanners follow links, they do not fill in forms.
 */

vi.mock('server-only', () => ({}));

interface Journal {
  touches: { stage: string; user_agent: string | null; link_type: string | null }[];
  verified: { token_hash?: string; type?: string }[];
  exchanged: string[];
}

let journal: Journal;
let verifyFails: boolean;

function install() {
  vi.doMock('@/lib/supabase', () => ({
    supabaseService: () => ({
      from: () => ({
        insert: async (row: Journal['touches'][number]) => {
          journal.touches.push(row);
          return { error: null };
        }
      })
    })
  }));

  vi.doMock('@supabase/ssr', () => ({
    createServerClient: () => ({
      auth: {
        verifyOtp: async (args: { token_hash: string; type: string }) => {
          journal.verified.push(args);
          return verifyFails ? { error: { message: 'Token has expired' } } : { error: null };
        },
        exchangeCodeForSession: async (code: string) => {
          journal.exchanged.push(code);
          return { error: null };
        }
      }
    })
  }));
}

async function route() {
  return import('@/app/api/auth/callback/route');
}

const LINK =
  'https://lexyflow.com/api/auth/callback?token_hash=abc123&type=magiclink&next=/fr/dashboard';

function get(url = LINK, userAgent = 'Mozilla/5.0') {
  return new Request(url, { headers: { 'user-agent': userAgent } }) as never;
}

function post(fields: Record<string, string>, headers: Record<string, string> = {}) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return new Request('https://lexyflow.com/api/auth/callback', {
    method: 'POST',
    body,
    headers: { 'user-agent': 'Mozilla/5.0', ...headers }
  }) as never;
}

beforeEach(() => {
  vi.resetModules();
  journal = { touches: [], verified: [], exchanged: [] };
  verifyFails = false;
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://test.supabase.co';
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon-test';
  install();
});

describe('opening the link spends nothing', () => {
  it('never verifies the token on a GET', async () => {
    const { GET } = await route();
    await GET(get());

    // This is the defect, stated directly. A scanner may do this any
    // number of times and the link stays usable.
    expect(journal.verified).toHaveLength(0);
    expect(journal.exchanged).toHaveLength(0);
  });

  it('redirects to the interstitial carrying the token untouched', async () => {
    const { GET } = await route();
    const res = await GET(get());

    expect(res.status).toBe(303);
    const to = new URL(res.headers.get('location')!);
    expect(to.pathname).toBe('/fr/auth/confirm');
    expect(to.searchParams.get('token_hash')).toBe('abc123');
    expect(to.searchParams.get('type')).toBe('magiclink');
    expect(to.searchParams.get('next')).toBe('/fr/dashboard');
  });

  it('survives being opened ten times, as a scanner would', async () => {
    const { GET } = await route();
    for (let i = 0; i < 10; i += 1) await GET(get());
    expect(journal.verified).toHaveLength(0);
  });

  it('shows the interstitial in the language the visitor asked for', async () => {
    // An Arabic-speaking visitor meeting an English confirmation screen
    // would find the one page between them and their account the least
    // trustworthy thing we had shown them.
    const { GET } = await route();
    const res = await GET(
      get('https://lexyflow.com/api/auth/callback?token_hash=t&type=magiclink&next=/ar/dashboard')
    );
    expect(new URL(res.headers.get('location')!).pathname).toBe('/ar/auth/confirm');
  });

  it('refuses to cache a URL that carries a credential', async () => {
    const { GET } = await route();
    const res = await GET(get());
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('sends a link with no token to sign-in rather than to a broken page', async () => {
    const { GET } = await route();
    const res = await GET(get('https://lexyflow.com/api/auth/callback?next=/fr/dashboard'));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/fr/login');
  });
});

describe('submitting the form is what signs you in', () => {
  it('verifies the token and redirects onward', async () => {
    const { POST } = await route();
    const res = await POST(
      post({ token_hash: 'abc123', type: 'magiclink', next: '/fr/dashboard' })
    );

    expect(journal.verified).toEqual([{ token_hash: 'abc123', type: 'magiclink' }]);
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/fr/dashboard');
  });

  it('accepts the PKCE code form as well', async () => {
    const { POST } = await route();
    await POST(post({ code: 'pkce-code', next: '/en/dashboard' }));
    expect(journal.exchanged).toEqual(['pkce-code']);
  });

  it('sends an expired link back to login, where it now says so', async () => {
    verifyFails = true;
    const { POST } = await route();
    const res = await POST(post({ token_hash: 'stale', type: 'magiclink', next: '/fr/dashboard' }));
    const to = new URL(res.headers.get('location')!);
    expect(to.pathname).toBe('/fr/login');
    expect(to.searchParams.get('error')).toBe('verify_failed');
  });

  it('refuses a cross-origin submission', async () => {
    // Login CSRF: a hostile page auto-submitting its own token would
    // sign the victim into an account the attacker controls, and then
    // read whatever the victim uploaded.
    const { POST } = await route();
    const res = await POST(
      post({ token_hash: 'abc', type: 'magiclink', next: '/fr/dashboard' }, { origin: 'https://evil.test' })
    );
    expect(journal.verified).toHaveLength(0);
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('bad_origin');
  });

  it('never honours a next that leaves our origin', async () => {
    const { POST } = await route();
    const res = await POST(post({ token_hash: 'a', type: 'magiclink', next: '//evil.test/x' }));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard');
  });
});

describe('the open is recorded, so we can tell a scanner from a person', () => {
  it('records the visit with its user agent and nothing identifying', async () => {
    const { GET } = await route();
    await GET(get(LINK, 'Mozilla/5.0 (compatible; Barracuda Sentinel)'));

    expect(journal.touches).toHaveLength(1);
    expect(journal.touches[0]!.stage).toBe('visited');
    expect(journal.touches[0]!.user_agent).toContain('Barracuda');
    // No email, no token, no IP. We sell GDPR audits.
    expect(JSON.stringify(journal.touches[0])).not.toContain('abc123');
    expect(Object.keys(journal.touches[0]!).sort()).toEqual(['link_type', 'stage', 'user_agent']);
  });

  it('records the confirmation separately, so the gap is measurable', async () => {
    const { POST } = await route();
    await POST(post({ token_hash: 'abc123', type: 'magiclink', next: '/fr/dashboard' }));
    expect(journal.touches.map((t) => t.stage)).toEqual(['confirmed']);
  });

  it('does not record a confirmation that failed', async () => {
    verifyFails = true;
    const { POST } = await route();
    await POST(post({ token_hash: 'stale', type: 'magiclink', next: '/fr/dashboard' }));
    expect(journal.touches).toHaveLength(0);
  });
});

describe('the interstitial itself', () => {
  const source = readFileSync(
    join(__dirname, '..', 'src/app/[locale]/auth/confirm/page.tsx'),
    'utf8'
  );

  it('is a plain form, not a script', () => {
    // It has to work with scripting off, inside an email client's
    // in-app browser, on an old phone.
    expect(source).toContain('method="post"');
    expect(source).toContain('action="/api/auth/callback"');
    expect(source).not.toContain("'use client'");
  });

  it('never auto-submits', () => {
    // Auto-submitting on load would restore the bug for any scanner
    // that runs a headless browser, which the better ones do.
    expect(source).not.toMatch(/useEffect|requestSubmit|\.submit\(\)|autoFocus.*submit/);
  });

  it('keeps itself out of search results and referrers', () => {
    expect(source).toContain('index: false');
    expect(source).toContain("referrer: 'no-referrer'");
  });
});
