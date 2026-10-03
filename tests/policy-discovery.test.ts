import { readdirSync, readFileSync } from 'node:fs';
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

  it('never uses another hostname’s page without asking that hostname', () => {
    // This guard used to read "never follows a link off the domain", and
    // it was discussed rather than deleted. The rule it protected was
    // "do not wander off crawling the web from a link" — not "a policy
    // on another hostname does not exist". google.fr does not host
    // Google's privacy policy, and refusing the link the site published
    // reported "no policy found" about a site that published one.
    //
    // The narrower rule that replaced it: only a link whose own anchor
    // text names a privacy policy, only from the homepage, at most two,
    // and only after that origin's robots.txt has been read — the same
    // terms on which this module already follows the site's own
    // redirect off-origin.
    expect(source).toContain("u.origin !== origin");
    expect(source).toContain('offsiteQueue');
    expect(source).toContain('readRobots(target.origin)');
    expect(source).toContain('isAllowed(target.pathname, theirRules)');
    expect(source).toContain('.slice(0, 2)');
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

describe('why nothing was read, told apart from what was read', () => {
  const source = code(SRC);

  /**
   * uber.fr failed in 148 milliseconds — far too fast for the seven
   * requests discovery makes — reporting "no policy link found from the
   * homepage or the usual paths". True, and about the wrong thing: nothing
   * had been read at all, and the message described a page nobody opened.
   * uber.com, a minute later, completed in 1.5 seconds.
   */

  it('carries the reason a fetch failed instead of returning null', () => {
    expect(source).toContain('interface Fetched');
    expect(source).toContain('error: `HTTP ${res.status}`');
    // Asserted on what the catch produces rather than on how. The first
    // version pinned the exact expression and failed the moment it was
    // replaced by describeFetchError, which does the same job better.
    const thrown = source.slice(source.indexOf('} catch (err) {'));
    expect(thrown.slice(0, 400)).toContain('describeFetchError(err)');
    expect(thrown.slice(0, 400)).toContain('error: reason');
  });

  it('separates "we could not read it" from "we read it and found nothing"', () => {
    expect(source).toContain('we could not read the homepage:');
    expect(source).toContain('links to no privacy policy');
  });

  it('still never says the company has no policy', () => {
    // Both sentences are about our fetch and about this document. Neither
    // is a claim about the organisation.
    const refusals = source.slice(source.indexOf('refused:'));
    expect(refusals).not.toMatch(/has no privacy policy|does not have/i);
  });
});

/**
 * The type and the constraint have to agree, and nothing was checking.
 *
 * `linked-offsite` was added to the Provenance union and never added to
 * the CHECK on scan_snapshots.provenance. The feature therefore worked
 * to the last step and then discarded its answer: the link found, that
 * origin's robots.txt read and obeyed, the document fetched and parsed,
 * and the insert rejected. lefigaro.fr and rfi.fr both did that on one
 * run.
 *
 * And the commit before it had just taught the observatory to exclude a
 * failed insert from the study — correctly, because a Postgres error
 * says nothing about a website. So the two defects composed: a bug I
 * shipped quietly removed real readings from a published sample, and the
 * instrument built to stop absences passing for results was what hid it.
 *
 * This guard reads both lists. Adding a provenance in TypeScript now
 * fails the suite until a migration adds it to the database too.
 */
describe('every provenance the code can write, the database accepts', () => {
  // Comment-stripped, and that is not cosmetic. Read raw, the union's
  // own doc comment contains "policies.google.com, not google.fr;" —
  // and the semicolon inside it ended the slice after the first member,
  // so this guard passed while the constraint was missing the value it
  // exists to catch. It was verified by deleting 'linked-offsite' from
  // the migration and watching it fail.
  const source = code(SRC);
  const migrations = readdirSync(join(__dirname, '..', 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(__dirname, '..', 'supabase', 'migrations', f), 'utf8'))
    .join('\n');

  it('declares the same four values on both sides', () => {
    const union = source.slice(source.indexOf('export type Provenance'));
    const declared = [...union.slice(0, union.indexOf(';')).matchAll(/'([a-z-]+)'/g)].map(
      (m) => m[1]!
    );

    expect(declared.length).toBeGreaterThan(0);

    // The newest definition of the constraint wins: earlier migrations
    // legitimately carry older, shorter lists.
    const checks = [...migrations.matchAll(/scan_snapshots_provenance_check[\s\S]*?\)\s*\)\s*;/g)];
    const newest = checks.at(-1)?.[0] ?? '';

    for (const value of declared) {
      expect(newest).toContain(`'${value}'`);
    }
  });
});
