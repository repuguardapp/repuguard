import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The front door of the acquisition loop.
 *
 * Somebody types a domain and everything downstream depends on our having
 * read the right document. Reporting factually on a document that is not the
 * document is the worst outcome available — every statement would be true of
 * something nobody asked about.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SRC = 'src/lib/policy-discovery.ts';

describe('how a document was found travels with it', () => {
  const source = code(SRC);

  it('distinguishes the site’s own answer from our guess', () => {
    // A policy found because the site linked to it IS the site's answer to
    // "where is your privacy policy". A policy found at /privacy because we
    // tried it is our guess, and a reader is entitled to know which.
    expect(source).toContain("'linked-from-homepage'");
    expect(source).toContain("'conventional-path'");
    expect(source).toContain('provenance');
  });

  it('only guesses when the site pointed at nothing', () => {
    expect(source).toContain('if (found.size === 0)');
  });

  it('keeps the conventional path list short', () => {
    // A long list is a crawl, and most of it would 404 on somebody else's
    // server for our convenience.
    const list = source.slice(source.indexOf('CONVENTIONAL_PATHS'));
    const paths = list.slice(0, list.indexOf(']')).match(/'\//g) ?? [];
    expect(paths.length).toBeLessThanOrEqual(6);
  });
});

describe('what it refuses to do', () => {
  const source = code(SRC);

  it('reads robots.txt before anything else and stops if refused', () => {
    expect(source).toContain('readRobots');
    expect(source).toContain("'robots.txt disallows us'");
    expect(source.indexOf('readRobots(origin)')).toBeLessThan(source.indexOf('const home ='));
  });

  it('never follows a link off the domain', () => {
    expect(source).toContain('u.origin !== origin');
  });

  it('refuses http', () => {
    // A compliance product reading a policy in clear would be quoting a
    // document any intermediary could have rewritten.
    expect(source).toContain("'https only'");
  });

  it('says why it found nothing instead of returning an empty answer', () => {
    // "Nothing found" is a fact about our search, never about the site. It
    // must not be rendered as "this company has no privacy policy": the
    // document may be behind a script, a login, or a path we did not try.
    expect(source).toContain('refused');
    expect(read(SRC)).toContain('a fact about the search, not about the site');
  });
});

describe('finding the document by what the site calls it', () => {
  const source = read(SRC);

  it('matches the anchor text, not the URL', () => {
    // `/legal/doc-3` with the anchor "Politique de confidentialité" is the
    // right document, and its path says nothing at all.
    // Asserted on the code rather than on the prose explaining it: the
    // match runs against `label`, which is the anchor's text, and never
    // against the href.
    expect(code(SRC)).toContain('POLICY_WORDS.some((word) => label.includes(word))');
    expect(code(SRC)).not.toMatch(/POLICY_WORDS\.some\([^)]*href/);
  });

  it('covers every language the product serves', () => {
    for (const word of [
      'privacy policy',
      'confidentialité',
      'privacidad',
      'datenschutz',
      'privacidade',
      'プライバシーポリシー',
      'الخصوصية'
    ]) {
      expect(source, `missing ${word}`).toContain(word);
    }
  });
});

describe('a domain that lives somewhere else', () => {
  const source = code(SRC);

  /**
   * The first real scan failed on uber.fr in 135 milliseconds. uber.fr
   * redirects to uber.com, and every link on the page we landed on was
   * rejected as cross-origin against the domain that had been typed. A
   * country domain pointing at a group's main site is ordinary, and
   * refusing to read it is refusing to answer the question asked.
   */

  it('adopts the origin the homepage actually landed on', () => {
    expect(source).toContain('const landed = new URL(home.url || origin).origin');
    expect(source).toContain('origin = landed');
  });

  it('re-reads robots.txt for the new origin before using any of its links', () => {
    // We were sent there by the site itself, so one request is fair.
    // Reading it without asking would not be.
    const redirect = source.slice(source.indexOf('const landed ='));
    expect(redirect.slice(0, 400)).toContain('await readRobots(origin)');
    expect(redirect.slice(0, 400)).toContain('isAllowed');
  });

  it('says where it was sent when the new origin refuses us', () => {
    expect(source).toContain('whose robots.txt disallows us');
  });

  it('fetches the homepage once, not twice', () => {
    // The redirect check and the link parse read the same response.
    expect((source.match(/await get\(origin, 'text\/html'\)/g) ?? []).length).toBe(1);
  });
});
