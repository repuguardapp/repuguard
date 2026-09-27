/**
 * One page, one row.
 *
 * Japan's PPC arrived in the corpus three times over:
 *
 *   /news/privacy_awareness_week
 *   /news/privacy_awareness_week?ref=gnavi
 *   /news/privacy_awareness_week/
 *
 * Three distinct `external_id`s, three inserts, three extraction calls to
 * a language model, three rejections of the same page. The idempotency key
 * was doing its job — those really are three different strings — and the
 * strings were the problem.
 *
 * WHAT IS STRIPPED, AND WHY THE LIST IS SHORT
 *
 * A trailing slash, a fragment, and a named set of navigation parameters.
 * Nothing else. It is tempting to drop every query string, and it would be
 * wrong: plenty of public bodies serve an article as `?id=4412` or
 * `?docweb=9876`, and a rule that threw those away would collapse a whole
 * archive onto one row. The Garante's own sitemap children are
 * `?p_l_id=…&layoutUuid=…`.
 *
 * So the default is to keep what we do not understand. `ref` and the utm_*
 * family are removed because they describe how a reader arrived, never
 * which document they arrived at — a distinction we can state rather than
 * guess.
 */

/**
 * Parameters that describe the journey, not the destination.
 *
 * `ref=gnavi` is Japan's global-navigation marker: the same page, reached
 * from the menu. Everything else here is advertising attribution.
 */
const NAVIGATION_PARAMS = new Set([
  'ref',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'igshid',
  '_ga'
]);

/**
 * The URL we store, or null when it is not a URL we can use.
 *
 * Returning null rather than the input on a parse failure: a string that
 * is not a URL has no business becoming a `primary_url` that a published
 * page will cite as its source.
 */
export function canonicalItemUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  // A fragment is a position on a page, not a page. It is also how the
  // ICO's accessibility skip link once became a watched "item".
  url.hash = '';

  for (const name of [...url.searchParams.keys()]) {
    if (NAVIGATION_PARAMS.has(name.toLowerCase()) || name.toLowerCase().startsWith('utm_')) {
      url.searchParams.delete(name);
    }
  }

  // Sorted, so `?a=1&b=2` and `?b=2&a=1` are one row rather than two.
  url.searchParams.sort();

  // The trailing slash, except on the root where it is not optional.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return url.toString();
}

/**
 * The identity we key idempotency on.
 *
 * A feed's own `guid` is kept untouched: it is the publisher's statement
 * about which entry this is, and it is more authoritative than anything we
 * could compute. Only an identifier that IS a URL gets canonicalised,
 * because only then are we the ones who chose it.
 */
export function canonicalExternalId(externalId: string): string {
  if (!/^https?:\/\//i.test(externalId)) return externalId;
  return canonicalItemUrl(externalId) ?? externalId;
}
