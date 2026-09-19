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
  vi.doMock('@/lib/safe-fetch', () => ({
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
    vi.doMock('@/lib/safe-fetch', () => ({
      fetchExternal: async () => {
        throw new Error('getaddrinfo ENOTFOUND example.test');
      }
    }));
    const { capture, refused } = await (await import('@/lib/policy-capture')).capturePolicy(
      'https://example.test/privacy'
    );
    expect(capture).toBeNull();
    expect(refused).toContain('could not fetch');
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
