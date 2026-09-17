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
    if (!absolute.pathname.includes(itemPattern)) continue;

    // The fragment is not part of the identity: /x#main and /x are one
    // decision, and treating them as two would publish it twice.
    absolute.hash = '';
    const link = absolute.toString();
    if (seen.has(link)) continue;

    // A "read more" or an empty anchor around an image carries no
    // title, and raw_title is what the reviewer reads first in the
    // queue. Counted rather than guessed at.
    if (title.length < 12) {
      skipped += 1;
      continue;
    }

    seen.add(link);
    items.push({
      externalId: link,
      title,
      link,
      // Never invented. Pass 2 reads the real date off the decision.
      publishedAt: null,
      excerpt: null
    });

    if (items.length >= maxItems) break;
  }

  return { items, skipped };
}
