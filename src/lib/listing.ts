import type { FeedItem, ParsedFeed } from './feeds';

/**
 * Read a regulator's news page when it has no feed.
 *
 * RSS is the exception, not the rule. The ICO withdrew every one of its
 * feeds; the Gulf authorities never had any; Brazil's ANPD and Japan's
 * PPC publish news pages. We sell audits against thirteen frameworks
 * and could watch two of them, because the watcher only spoke RSS —
 * which meant the decisions corpus, the one thing on this site nobody
 * else publishes, could only ever be European.
 *
 * So: fetch the listing page, take the links that match a pattern the
 * source defines, and hand them to the same pipeline. An item here is
 * thinner than a feed item — a URL and the anchor text — and that is
 * enough, because pass 2 reads the decision page itself for every fact
 * that matters.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not guess a date. A listing shows "12 September" with no
 * year, or a relative date, or nothing; the feed parser already refuses
 * to invent one and so does this. The extractor reads the decision date
 * off the page, and has the rule that a deliberation's own date beats
 * the prose — which is what stopped us publishing a CNIL fine under the
 * wrong date in the first place.
 *
 * It does not follow pagination. One page of a regulator's news is
 * between ten and fifty items, the poller runs four times a day, and a
 * crawler that walks a site is a different and much more intrusive
 * thing than one that reads the page a human would open.
 */

/** Anchors, with their href and inner text, in document order. */
const ANCHOR = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A provisional title read off the URL the regulator itself chose.
 *
 * Not an invention: `/notas-de-prensa/la-aepd-sanciona-a-una-empresa/` is
 * the authority's own wording, and it is replaced wholesale by pass 2,
 * which reads the decision page for every fact that is published. Its only
 * job is to let a human recognise the row in the review queue.
 *
 * Deliberately strict, because a bad provisional title is worse than a
 * skipped item: a slug has to look like a sentence — three words and
 * twenty characters — before it is worth showing. `/enforcement/short/`
 * yields "short", which tells a reviewer nothing, so it stays skipped and
 * stays counted.
 */
export function titleFromSlug(pathname: string): string | null {
  const slug = pathname.split('/').filter(Boolean).pop() ?? '';
  const words = slug
    .replace(/\.(html?|php|aspx?|pdf)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (words.length < 20 || words.split(' ').length < 3) return null;
  // Digits-only paths (/news/2026/09/17/) are a date, not a headline.
  if (!/[a-z]{3}/i.test(words)) return null;

  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface ListingOptions {
  /**
   * Which links are items. A plain substring of the path, not a regex:
   * the value is written by an operator into a database row, and a
   * regex there is a way to hang the poller on a page we do not
   * control.
   */
  itemPattern: string;
  /** Resolves relative hrefs, and bounds which links may be taken. */
  baseUrl: string;
  /** A regulator's news page is tens of items; anything more is a bug. */
  maxItems?: number;
}

/**
 * Parse a listing page into the same shape parseFeed returns, so the
 * caller does not care which kind of source it polled.
 */
export function parseListing(html: string, options: ListingOptions): ParsedFeed {
  const { itemPattern, baseUrl, maxItems = 60 } = options;

  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return { items: [], skipped: 0 };
  }

  const items: FeedItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const match of html.matchAll(ANCHOR)) {
    const rawHref = match[1]!;
    const title = textOf(match[2] ?? '');

    // An href that is only a fragment goes nowhere: it is the skip link,
    // the "back to top", the accordion toggle. Resolved against the
    // listing it becomes the listing's own URL, and the ICO's entire
    // corpus — one row, across every run this pipeline has ever made —
    // was its accessibility skip link, stored under the title "Skip to
    // main content" while the source reported ok.
    if (rawHref.startsWith('#')) continue;

    let absolute: URL;
    try {
      absolute = new URL(rawHref, baseUrl);
    } catch {
      skipped += 1;
      continue;
    }

    // Same origin only. A regulator's page links to Twitter, to the
    // EUR-Lex text, to a PDF on another ministry's server; following
    // those would fill the queue with things nobody asked us to watch.
    if (absolute.origin !== origin) continue;
    const at = absolute.pathname.indexOf(itemPattern);
    if (at === -1) continue;

    // An item lives UNDER the section; it is not the section. Without
    // this, the page's own "Notas de prensa" link matches the pattern,
    // carries a perfectly good title, and enters the review queue as a
    // decision — a listing page presented to a reviewer as a sanction.
    // Every regulator links back to the index it is showing you.
    if (absolute.pathname.slice(at + itemPattern.length).replace(/\/+$/, '') === '') continue;

    // The fragment is not part of the identity: /x#main and /x are one
    // decision, and treating them as two would publish it twice.
    absolute.hash = '';
    const link = absolute.toString();
    if (seen.has(link)) continue;

    // A "read more" or an empty anchor around an image carries no title,
    // and raw_title is what the reviewer reads first in the queue.
    //
    // The AEPD publishes exactly that way: the headline sits in a heading
    // and the only link to the decision is the words "Leer más". Eight
    // decisions per page, eight links found, eight refused — the source
    // reported "no items" while working perfectly. Refusing a whole
    // regulator over the wording of its anchors is the wrong trade.
    const usable = title.length >= 12 ? title : titleFromSlug(absolute.pathname);
    if (!usable) {
      skipped += 1;
      continue;
    }

    seen.add(link);
    items.push({
      externalId: link,
      title: usable,
      link,
      // Never invented. Pass 2 reads the real date off the decision.
      publishedAt: null,
      excerpt: null
    });

    if (items.length >= maxItems) break;
  }

  return { items, skipped };
}

/**
 * What the page actually contained, for when it yielded nothing.
 *
 * `no_items (skipped 8, 138832 bytes)` says a fetch succeeded and a parse
 * found nothing — true, and useless. It does not say whether the pattern
 * matched nothing, or matched links whose anchors carry no text, and those
 * are opposite repairs. Worse, the only way to find out was to open the
 * regulator's page by hand, which this sandbox cannot reach: the source
 * would then stay dead for as long as nobody happened to look.
 *
 * So on failure the poller now writes down what it saw — the commonest
 * same-origin path prefixes, and the anchors that matched but were refused
 * for having no usable title. That is enough to choose the right
 * `item_pattern` from the error message alone, without reaching the site.
 *
 * Same principle as recording every way a sign-in can be refused: an
 * instrument that reports only that something failed is an instrument for
 * failures you already understood.
 */
export function describeListing(html: string, options: ListingOptions): string {
  let origin: string;
  try {
    origin = new URL(options.baseUrl).origin;
  } catch {
    return 'base_url unparseable';
  }

  const prefixes = new Map<string, number>();
  const untitled: string[] = [];
  const deep: string[] = [];
  let anchors = 0;

  for (const match of html.matchAll(ANCHOR)) {
    let absolute: URL;
    try {
      absolute = new URL(match[1]!, options.baseUrl);
    } catch {
      continue;
    }
    if (absolute.origin !== origin) continue;
    anchors += 1;

    // Three segments, not two. Two was enough for Spain and told us
    // nothing about Brazil, where the whole site lives under /anpd/pt-br/
    // so every link collapsed to one useless bucket: "59 links, all in
    // the same place" is the shape of the answer, not the answer.
    const segments = absolute.pathname.split('/').filter(Boolean);
    const prefix = `/${segments.slice(0, 3).join('/')}/`;
    prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);

    // And a couple of whole paths, because a prefix census cannot show
    // what an actual decision URL looks like. The deepest ones are the
    // articles; navigation is always shallow.
    if (segments.length >= 3) deep.push(absolute.pathname);

    if (absolute.pathname.includes(options.itemPattern) && untitled.length < 3) {
      const title = textOf(match[2] ?? '');
      if (title.length < 12) untitled.push(JSON.stringify(title));
    }
  }

  const top = [...prefixes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([path, count]) => `${path}×${count}`)
    .join(' ');

  const parts = [`${anchors} same-origin links`, top || 'no same-origin links'];

  const samples = [...new Set(deep)]
    .sort((a, b) => b.length - a.length)
    .slice(0, 2)
    .join(' ');
  if (samples) parts.push(`deepest: ${samples}`);

  if (untitled.length > 0) parts.push(`pattern matched, no title: ${untitled.join(' ')}`);
  return parts.join('; ');
}
