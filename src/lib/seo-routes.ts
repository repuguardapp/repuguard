import { FRAMEWORKS, type FrameworkId, type LegalFramework } from './legal-frameworks';

/**
 * Programmatic-SEO routing helpers.
 *
 * Two route families ship from a single source of truth here:
 *
 *   1. /[locale]/compliance/[framework] — a deep-dive landing page
 *      per framework, per locale. 7 × 13 = 91 pages. Targets
 *      informational + lower-funnel queries ("saudi pdpl audit",
 *      "gdpr compliance tool").
 *
 *   2. /[locale]/compare/[pair] — comparison pages between two
 *      frameworks. The pair slug is "<a>-vs-<b>" with a strict
 *      alphabetical ordering so we don't expose two URLs for the
 *      same comparison and split link equity. Targets commercial-
 *      investigation queries ("gdpr vs saudi pdpl differences").
 *
 * Why we DON'T expose all C(13,2) = 78 pair permutations:
 * Google's Helpful Content update penalises programmatic farms of
 * thin pages. We hand-curate ~38 commercially meaningful pairs —
 * everything that crosses jurisdictions a real compliance officer
 * actually evaluates side-by-side. The list is small enough to
 * write quality content for and large enough to capture the long-
 * tail at ~266 pages × 7 locales.
 */

/**
 * Strict alphabetical pair key — used as the URL slug and as the
 * map key. `frameworkPairKey(a, b)` and `frameworkPairKey(b, a)`
 * return the same string, so callers can pass the IDs in any order
 * and link equity stays consolidated on one URL.
 */
export function frameworkPairKey(a: FrameworkId, b: FrameworkId): string {
  const [first, second] = [a, b].sort();
  return `${first}-vs-${second}`;
}

/**
 * Parse a `<a>-vs-<b>` slug back into the two framework ids. Returns
 * null when the slug is malformed or references an unknown
 * framework — the page component should call notFound() on null.
 */
export function parseFrameworkPairSlug(slug: string): { a: LegalFramework; b: LegalFramework } | null {
  const match = /^([a-z0-9_]+)-vs-([a-z0-9_]+)$/.exec(slug);
  if (!match) return null;
  const [, aId, bId] = match;
  const a = FRAMEWORKS.find((f) => f.id === aId);
  const b = FRAMEWORKS.find((f) => f.id === bId);
  if (!a || !b || a.id === b.id) return null;
  // Canonical ordering — refuse to render the inverted slug so it
  // can be 301-redirected to the canonical one in middleware later.
  if (frameworkPairKey(a.id, b.id) !== slug) return null;
  return { a, b };
}

/**
 * Curated comparison pairs. We expose:
 *   - GDPR vs every other framework (12 pairs — the obvious
 *     "how does my home regulation compare to X" search).
 *   - EU AI Act vs GDPR and vs UK GDPR (high-intent for EU
 *     companies navigating AI compliance overlap).
 *   - Every GCC framework vs every other GCC framework
 *     (C(6,2) = 15 pairs — the cross-Gulf compliance officer's
 *     bread-and-butter comparison).
 *   - UK GDPR vs EU GDPR (single highest-volume divergence query
 *     post-Brexit).
 *   - CCPA vs GDPR (US-West-Coast compliance crossover).
 *   - APPI vs GDPR, LGPD vs GDPR (emerging-market vs Europe).
 *   - PIPEDA vs GDPR (Canada vs Europe).
 *
 *   - The two Emirati free zones against the federal law and against
 *     each other (3 pairs).
 *
 * No total is written here. The arithmetic in this comment said 38 while
 * the function built 30, and it had said so through at least two changes
 * to the list — a stale number in a comment is not a small thing in a file
 * whose whole job is to decide how many pages exist. CURATED_PAIRS.length
 * is the answer, and a test asserts it against the rules above.
 *
 * Every entry generates one page per locale, so a single pair costs seven
 * routes.
 */
const GCC_IDS: readonly FrameworkId[] = [
  'qatar_pdppl',
  'saudi_pdpl',
  'uae_pdpl',
  'bahrain_pdpl',
  'kuwait_dppr',
  'oman_pdpl'
];

function buildCuratedPairs(): readonly string[] {
  const out = new Set<string>();

  // GDPR vs everything else
  for (const f of FRAMEWORKS) {
    if (f.id !== 'gdpr') out.add(frameworkPairKey('gdpr', f.id));
  }

  // EU AI Act overlaps
  out.add(frameworkPairKey('eu_ai_act', 'gdpr'));
  out.add(frameworkPairKey('eu_ai_act', 'uk_gdpr'));

  // GCC × GCC (intra-Gulf — every pair)
  for (let i = 0; i < GCC_IDS.length; i++) {
    for (let j = i + 1; j < GCC_IDS.length; j++) {
      out.add(frameworkPairKey(GCC_IDS[i]!, GCC_IDS[j]!));
    }
  }

  // The Emirati free zones, against the federal law and against each other.
  //
  // Not folded into the GCC matrix above: that matrix answers "how does
  // Qatar differ from Oman", a question about six countries. These answer a
  // different and far more common one — "there are three data protection
  // laws in this country, which am I under?" — which is the first thing
  // anyone setting up in Dubai or Abu Dhabi has to establish, and the
  // question our own audit form is designed not to guess at.
  out.add(frameworkPairKey('difc_dp', 'uae_pdpl'));
  out.add(frameworkPairKey('adgm_dp', 'uae_pdpl'));
  out.add(frameworkPairKey('difc_dp', 'adgm_dp'));

  return [...out];
}

export const CURATED_PAIRS: readonly string[] = buildCuratedPairs();

/**
 * generateStaticParams payload for the single-framework route.
 * Returns [{ framework: 'gdpr' }, { framework: 'saudi_pdpl' }, …]
 * to be cross-multiplied with the [locale] dynamic segment by
 * Next.js automatically.
 */
export function frameworkParams(): { framework: string }[] {
  return FRAMEWORKS.map((f) => ({ framework: f.id }));
}

/**
 * generateStaticParams payload for the comparison route.
 */
export function comparisonParams(): { pair: string }[] {
  return CURATED_PAIRS.map((pair) => ({ pair }));
}

/**
 * Internal-linking helper: given a framework, return up to N other
 * frameworks that share a meaningful link surface (same region, same
 * AI-adjacency, GCC cluster). The single-framework page uses this to
 * surface related comparison pages and concentrate link equity.
 */
export function relatedFrameworks(id: FrameworkId, n = 4): LegalFramework[] {
  const self = FRAMEWORKS.find((f) => f.id === id);
  if (!self) return [];
  const scored = FRAMEWORKS.filter((f) => f.id !== id).map((other) => {
    let score = 0;
    if (GCC_IDS.includes(self.id) && GCC_IDS.includes(other.id)) score += 5;
    // The three Emirati regimes point at each other before anything else:
    // a reader on the DIFC page is far more likely to need the federal PDPL
    // or the ADGM regulations next than to need Oman.
    if (self.jurisdiction.startsWith('AE') && other.jurisdiction.startsWith('AE')) score += 5;
    if (self.jurisdiction.startsWith('EU') && other.jurisdiction.startsWith('EU')) score += 3;
    if (other.id === 'gdpr') score += 2; // GDPR is always a useful comparison
    if (other.id === 'eu_ai_act' && self.id === 'gdpr') score += 2;
    return { other, score };
  });
  return scored
    .sort((x, y) => y.score - x.score)
    .slice(0, n)
    .map((s) => s.other);
}
