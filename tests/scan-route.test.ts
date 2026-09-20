import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { normaliseDomain } from '@/app/api/scan/route';

/**
 * This endpoint fetches somebody else's server on a stranger's instruction.
 *
 * That is the property that shapes every test here. Without limits it is a
 * free scanning proxy: anyone could point it at a target and have our
 * infrastructure, our address and our reputation make the requests.
 */

vi.mock('server-only', () => ({}));

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SRC = 'src/app/api/scan/route.ts';

describe('what a visitor typed', () => {
  it('treats the three ways of writing one site as one site', () => {
    // Otherwise the same company gets knocked on three times for one scan.
    for (const input of [
      'example.com',
      'EXAMPLE.COM',
      ' https://www.example.com/privacy?utm=x ',
      'www.example.com'
    ]) {
      expect(normaliseDomain(input), input).toBe('example.com');
    }
  });

  it('keeps a subdomain that is not www', () => {
    expect(normaliseDomain('eu.example.com')).toBe('eu.example.com');
  });

  it('refuses an IP address', () => {
    // An IP has no published privacy policy, and scanning one on request is
    // the shape of a port scanner rather than of this product.
    expect(normaliseDomain('192.168.1.1')).toBeNull();
    expect(normaliseDomain('http://10.0.0.1/')).toBeNull();
  });

  it('refuses a host with no public suffix', () => {
    expect(normaliseDomain('localhost')).toBeNull();
    expect(normaliseDomain('printer.local')).toBeNull();
    expect(normaliseDomain('intranet')).toBeNull();
  });

  it('refuses nonsense rather than guessing', () => {
    expect(normaliseDomain('')).toBeNull();
    expect(normaliseDomain('   ')).toBeNull();
    expect(normaliseDomain('not a domain at all')).toBeNull();
  });
});

describe('two ceilings, and the second one matters more', () => {
  const source = code(SRC);

  it('limits the person asking', () => {
    expect(source).toContain('`scan:ip:${ip}`');
  });

  it('limits the site being asked about, more tightly', () => {
    // The only limit that protects somebody who is not our visitor.
    expect(source).toContain('`scan:domain:${domain}`');
    const perDomain = source.slice(source.indexOf('scan:domain:'));
    expect(perDomain).toContain('max: 4');
  });

  it('reuses a recent result instead of knocking again', () => {
    // Ten people sharing a scan link must not become ten requests to that
    // company's server.
    expect(source).toContain('REUSE_WINDOW_MINUTES');
    expect(source).toContain("eq('status', 'done')");
    expect(source).toContain('reused: true');
  });
});

describe('the pipeline always ends somewhere', () => {
  const source = code(SRC);

  it('answers before doing the work', () => {
    // A page that hangs on a stranger's TLS handshake is a page people
    // close.
    // Matched on the FINAL return, not on any return carrying a token: the
    // reuse branch returns one earlier and legitimately, and the first
    // version of this assertion caught that one instead.
    expect(source).toContain('waitUntil(run(scan.id, domain))');
    expect(source.indexOf('waitUntil(run')).toBeLessThan(
      source.indexOf('return NextResponse.json({ token, reused: false })')
    );
  });

  it('never leaves a scan running', () => {
    // A row stuck at `running` is a page that spins for ever, and the
    // visitor cannot tell that from a slow server.
    const pipeline = source.slice(source.indexOf('async function run'));
    expect(pipeline).toContain('catch');
    const terminal = pipeline.match(/status: '(failed|done)'/g) ?? [];
    expect(terminal.length).toBeGreaterThanOrEqual(4);
  });

  it('tries the site’s own link before its own guess', () => {
    // discoverPolicy returns homepage links first; the loop must not
    // reorder them.
    expect(source).toContain('discovery.candidates.slice(0, 3)');
    expect(source).not.toMatch(/candidates\.(sort|reverse)/);
  });

  it('records the failure as a fact about our search', () => {
    expect(read(SRC)).toContain('not ours to say');
    expect(source).toContain('failure: discovery.refused');
  });

  it('stores evidence only for a present finding', () => {
    // Evidence for an absence would be evidence of nothing.
    expect(source).toContain('evidence: o.evidence ?? null');
  });
});

describe('seven blanks are our failure, not their document', () => {
  const source = code(SRC);

  /**
   * airbnb.com passed capture and produced seven not_founds, which the page
   * published about a company that plainly does have a detailed privacy
   * policy. A genuine policy answers at least one of the seven questions;
   * seven blanks is far more likely to be our failure than the document's
   * content.
   *
   * The same shape as the sub-processor rule that an empty extraction is
   * never a change — and it exists here because the capture guard, on its
   * own, let one through.
   */

  it('refuses to publish a result with no established observation', () => {
    expect(source).toContain("!observations.some((o) => o.finding === 'present')");
    expect(source).toContain('does not look like a privacy policy');
  });

  it('fails the scan rather than storing the blanks', () => {
    // Storing them and hiding them on the page would leave the claim in the
    // database for something else to read later.
    const guard = source.slice(source.indexOf("!observations.some"));
    expect(guard.slice(0, 400)).toContain("status: 'failed'");
    expect(guard.indexOf('finish(')).toBeLessThan(guard.indexOf('scan_observations'));
  });

  it('says it in the visitor’s language, about our read and not their company', () => {
    for (const locale of ['en', 'fr', 'es', 'de', 'pt-br', 'ja', 'ar']) {
      const scan = JSON.parse(read(`messages/${locale}.json`)).scan as Record<string, string>;
      expect(scan['failureNotAPolicy'], locale).toBeTruthy();
    }
    const fr = JSON.parse(read('messages/fr.json')).scan as Record<string, string>;
    expect(fr['failureNotAPolicy']).toMatch(/Nous avons lu une page/);
    expect(fr['failureNotAPolicy']).not.toMatch(/n'a pas de politique|non conforme/);
  });
});
