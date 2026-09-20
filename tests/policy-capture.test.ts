import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Everything the public scan publishes is a statement about a specific
 * document fetched at a specific moment. That is only defensible if the
 * document can be identified again by somebody who does not trust us.
 */

vi.mock('server-only', () => ({}));

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SRC = 'src/lib/policy-capture.ts';

const POLICY_HTML =
  '<html><body><h1>Privacy Policy</h1>' +
  `<p>${'We process personal data for the purposes described below. '.repeat(60)}</p>` +
  '</body></html>';

function mockFetch(body: string | Uint8Array, init: { status?: number; type?: string; url?: string } = {}) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  // importOriginal keeps describeFetchError real: the point of these tests
  // is what the module says about a failure, and a stubbed describer would
  // be testing the stub.
  vi.doMock('@/lib/safe-fetch', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/safe-fetch')>()),
    fetchExternal: async () =>
      ({
        ok: (init.status ?? 200) < 400,
        status: init.status ?? 200,
        url: init.url ?? 'https://example.test/privacy',
        headers: new Headers({ 'content-type': init.type ?? 'text/html; charset=utf-8' }),
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      }) as unknown as Response
  }));
}

const load = async () => (await import('@/lib/policy-capture')).capturePolicy;

beforeEach(() => vi.resetModules());

describe('the hash is the promise', () => {
  it('hashes the raw bytes, so a stranger can reproduce it', async () => {
    mockFetch(POLICY_HTML);
    const { capture } = await (await load())('https://example.test/privacy');

    const expected = createHash('sha256').update(new TextEncoder().encode(POLICY_HTML)).digest('hex');
    expect(capture?.contentHash).toBe(expected);
  });

  it('does not hash the extracted text', () => {
    // Hashing the text would mean that improving the extractor changes the
    // hash of documents that never changed, and every stored observation
    // starts pointing at a document that no longer exists by that id.
    const source = code(SRC);
    // The statement itself, cut at its semicolon — an 80-character window
    // spilled onto the next line, which declares `const text`, and the test
    // reported the neighbouring line as the offence.
    const after = source.slice(source.indexOf("createHash('sha256')"));
    const statement = after.slice(0, after.indexOf(';') + 1);
    expect(statement).toContain('update(bytes)');
    expect(statement).not.toContain('text');
  });

  it('records the URL after redirects, not the one we asked for', async () => {
    // A policy reached from /privacy but living at /legal/privacy should be
    // cited where it actually is.
    mockFetch(POLICY_HTML, { url: 'https://example.test/legal/privacy' });
    const { capture } = await (await load())('https://example.test/privacy');
    expect(capture?.url).toBe('https://example.test/legal/privacy');
  });
});

describe('every refusal is a fact about our fetch', () => {
  it('never returns an empty capture without saying why', async () => {
    mockFetch('nope', { status: 404 });
    const { capture, refused } = await (await load())('https://example.test/privacy');
    expect(capture).toBeNull();
    expect(refused).toContain('404');
  });

  it('refuses a shell page instead of reporting that it says nothing', async () => {
    /**
     * The lesson the sub-processor diff already paid for. A single-page
     * application answers 200 with a skeleton, and reading that as "this
     * policy states no retention period" would be a factual claim about a
     * document we never actually read.
     */
    mockFetch('<html><body><div id="root"></div></body></html>');
    const { capture, refused } = await (await load())('https://example.test/privacy');

    expect(capture).toBeNull();
    expect(refused).toContain('built in the browser');
  });

  it('refuses a PDF rather than half-reading it', async () => {
    // A PDF run through an HTML extractor produces plausible-looking
    // nonsense, which is exactly what this product cannot ship.
    mockFetch('%PDF-1.7 ...', { type: 'application/pdf' });
    const { capture, refused } = await (await load())('https://example.test/privacy.pdf');
    expect(capture).toBeNull();
    expect(refused).toContain('PDF');
  });

  it('refuses a document too large to be a privacy policy', async () => {
    mockFetch(new Uint8Array(5 * 1024 * 1024));
    const { refused } = await (await load())('https://example.test/privacy');
    expect(refused).toContain('larger than');
  });

  it('turns a network failure into a sentence, not a throw', async () => {
    vi.doMock('@/lib/safe-fetch', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/safe-fetch')>()),
      fetchExternal: async () => {
        // Shaped like the real thing: Node wraps the transport failure and
        // puts the reason in `cause`.
        const err = new TypeError('fetch failed');
        (err as { cause?: unknown }).cause = Object.assign(
          new Error('getaddrinfo ENOTFOUND example.test'),
          { code: 'ENOTFOUND' }
        );
        throw err;
      }
    }));
    const { capture, refused } = await (await import('@/lib/policy-capture')).capturePolicy(
      'https://example.test/privacy'
    );
    expect(capture).toBeNull();
    expect(refused).toContain('could not fetch');
    // And the reason, not Node's wrapper. "fetch failed" names the layer
    // that failed and nothing else.
    expect(refused).toContain('ENOTFOUND');
    expect(refused).not.toContain('fetch failed');
  });
});

describe('a real capture', () => {
  it('carries what a citation needs', async () => {
    mockFetch(POLICY_HTML);
    const { capture } = await (await load())('https://example.test/privacy');

    // URL, hash and timestamp: the three things without which an
    // observation is an opinion.
    expect(capture?.url).toBeTruthy();
    expect(capture?.contentHash).toHaveLength(64);
    expect(Date.parse(capture!.fetchedAt)).not.toBeNaN();
    expect(capture?.text).toContain('personal data');
  });
});

describe('what airbnb.com taught, at a named company’s expense', () => {
  /**
   * 247KB of HTML produced 1,960 characters of text — 0.8% — cleared the
   * 1,500-character floor by 460, and the scan published seven blank
   * observations about a company that plainly does have a detailed privacy
   * policy. The two documents read correctly that day, Uber's and our own,
   * both sat at 5.4%.
   *
   * A large file yielding almost no prose is a page assembled in the
   * browser: the bytes are script, not text. The absolute floor cannot see
   * that, because a shell of a big site clears it comfortably.
   */

  it('refuses a bulky page that yields almost no prose', async () => {
    const shell = `<html><body>${'<script>var x=1;</script>'.repeat(9000)}<p>${'mot '.repeat(400)}</p></body></html>`;
    mockFetch(shell);
    const { capture, refused } = await (await load())('https://example.test/privacy');

    expect(capture).toBeNull();
    expect(refused).toContain('built in the browser');
    expect(refused).toContain('KB of HTML');
  });

  it('still accepts a long document from a large page', async () => {
    // Uber's notice is 1.1MB of HTML and 63,000 characters of text. The
    // rule must not refuse a real policy for being on a heavy site.
    const real = `<html><body>${'<script>var x=1;</script>'.repeat(4000)}<p>${'We process personal data for the purposes described below. '.repeat(120)}</p></body></html>`;
    mockFetch(real);
    const { capture } = await (await load())('https://example.test/privacy');
    expect(capture).not.toBeNull();
  });

  it('drops the site chrome before reading', async () => {
    // Our own scan quoted "日本語 العربية Se connecter Lancer un audit" as
    // evidence, because the header sits inside the page we fetched. On
    // another site a footer link or a cookie banner could turn navigation
    // into a finding.
    const withChrome =
      '<html><body><header>Se connecter Lancer un audit</header>' +
      `<nav>Tarifs Documentation</nav><p>${'We retain personal data for twelve months. '.repeat(60)}</p>` +
      '<footer>Politique de confidentialité Mentions légales</footer></body></html>';

    mockFetch(withChrome);
    const { capture } = await (await load())('https://example.test/privacy');

    expect(capture?.text).toContain('retain personal data');
    expect(capture?.text).not.toContain('Se connecter');
    expect(capture?.text).not.toContain('Mentions légales');
  });
});
