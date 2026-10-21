import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The two doors were the slowest pages on the site.
 *
 * supabaseService() sets `cache: 'no-store'` on every fetch, for reasons
 * that have nothing to do with these pages. Next sees that inside a
 * static route and refuses to prerender it, which is why the 21 October
 * build logged, once per locale:
 *
 *   [legal-decisions] list_failed
 *     Dynamic server usage: no-store fetch … /ar/decisions
 *
 * The route then rendered on demand. It worked — production served all
 * 44 rows in Arabic — but every visit paid a database round trip, on the
 * hub every decision links back to and on the one page that has ever
 * earned an organic visit. A crawler forms its view of how fast a host
 * answers on the pages it visits most, and applies it to the whole site.
 *
 * These are 14 URLs out of 658. The point is not their number.
 */

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const DECISIONS_LIB = read('src/lib/legal-decisions.ts');
const OBSERVATORY_LIB = read('src/lib/observatory.ts');
const HUB = read('src/app/[locale]/decisions/page.tsx');
const OBSERVATORY = read('src/app/[locale]/observatory/page.tsx');

describe('the hub reads through a cache', () => {
  it('uses the cached list, not the raw one', () => {
    expect(HUB).toContain('listPublishedDecisionsCached(params.locale)');
    expect(HUB).not.toMatch(/await listPublishedDecisions\(/);
  });

  it('and so does the framework listing, which shares the read', () => {
    expect(DECISIONS_LIB).toContain('await listPublishedDecisionsCached(locale, 500)');
  });
});

describe('the observatory keeps its measurement and loses its query', () => {
  it('still renders per request, because it reads the Referer', () => {
    /**
     * This is the trade that must NOT be reversed to buy speed. The
     * sixty-day backlink test exists to see who arrives, and the only
     * external referral we have ever recorded — seven clicks from a
     * Google result — was caught by exactly this. A page cached for an
     * hour cannot see an arrival.
     */
    expect(OBSERVATORY).toContain("export const dynamic = 'force-dynamic'");
    expect(OBSERVATORY).toContain('recordReferral');
  });

  it('but reads its report from the cache', () => {
    expect(OBSERVATORY).toContain('observatoryReportCached()');
  });
});

describe('a failure is never remembered', () => {
  /**
   * unstable_cache stores whatever it is given, a null included. If the
   * wrapped read returned null on failure, one bad second at the
   * database would pin "this list could not be loaded" on the hub for a
   * full hour — a false statement about our own corpus, served to
   * everyone, long after the cause had passed.
   *
   * So the inner function throws and the wrapper catches: a throw caches
   * nothing and the next request tries again.
   */
  it('throws inside the cache rather than caching a null', () => {
    expect(DECISIONS_LIB).toContain("throw new Error('legal_decisions_unreadable')");
    expect(OBSERVATORY_LIB).toContain("throw new Error('observatory_unreadable')");
  });

  it('catches outside it, so the caller still sees null', () => {
    for (const lib of [DECISIONS_LIB, OBSERVATORY_LIB]) {
      expect(lib).toMatch(/catch\s*{\s*return null;\s*}/);
    }
  });

  it('never turns an unreadable corpus into an empty one', () => {
    // `return []` inside the cached read would be the same bug wearing
    // a friendlier face: an hour of "no decisions published yet" over a
    // blink, which is a claim about the law rather than about us.
    const cached = DECISIONS_LIB.slice(
      DECISIONS_LIB.indexOf('const readPublished'),
      DECISIONS_LIB.indexOf('export async function listPublishedDecisionsCached')
    );
    expect(cached).not.toMatch(/return \[\];/);
  });
});

describe('the cache window is bounded and stated', () => {
  it('revalidates hourly, matching the pages it serves', () => {
    // The publication cron runs every six hours, so nothing is ever
    // stale by more than a sixth of a publishing cycle.
    expect(DECISIONS_LIB).toContain('revalidate: 3600');
    expect(OBSERVATORY_LIB).toContain('revalidate: 3600');
    expect(HUB).toMatch(/export const revalidate = 3600/);
  });
});
