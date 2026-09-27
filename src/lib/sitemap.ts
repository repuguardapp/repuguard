import type { FeedItem, ParsedFeed } from './feeds';
import { titleFromSlug } from './listing';

/**
 * Read a regulator's sitemap when its pages are built in the browser.
 *
 * Half the authorities we need are single-page applications. The ICO's
 * enforcement listing carries 39 links and not one decision; SDAIA's news
 * page carries six, two of which are the cookie banner's "yes" and "no";
 * Qatar's NCSA returns 5KB containing no links at all. No `item_pattern`
 * will ever read those, because the decisions are genuinely not in the
 * document a crawler receives. Last night I called that a limit of method.
 *
 * It is not. A site that renders its list in the browser still has to be
 * found by search engines, so it publishes the same list as XML — server
 * side, complete, machine-readable, and advertised in robots.txt. The
 * sitemap is the listing page without the JavaScript.
 *
 * It is also the politest thing on the site: a file whose entire purpose is
 * to be fetched by robots, so that they do not have to crawl.
 *
 * WHAT THIS TAKES FROM IT, AND WHAT IT REFUSES
 *
 * A URL, and `lastmod` when the sitemap carries one — a real date, stated
 * by the regulator about its own page, which is the only kind this pipeline
 * will store. Nothing else: a sitemap has no titles, so the provisional one
 * comes from the authority's own slug and is replaced wholesale by pass 2,
 * which reads the decision itself.
 */

const URL_BLOCK = /<url\b[\s\S]*?<\/url>/gi;
const LOC = /<loc>\s*([\s\S]*?)\s*<\/loc>/i;
const LASTMOD = /<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i;
const SITEMAP_BLOCK = /<sitemap\b[\s\S]*?<\/sitemap>/gi;

/**
 * How many children of an index we keep, after sorting by lastmod.
 *
 * The cap is about our own memory, not about politeness — the caller
 * decides how many to actually fetch. It sits after the sort so that a
 * 320-child index keeps its 40 most recently changed, not its first 40.
 */
const MAX_INDEX_CHILDREN = 40;

export interface SitemapOptions {
  /** A substring every decision URL's path contains. */
  itemPattern: string;
  /** Bounds which URLs may be taken, and resolves nothing — locs are absolute. */
  baseUrl: string;
  maxItems?: number;
}

/** One entry of a sitemap index: where it is, and when it last changed. */
export interface SitemapChild {
  url: string;
  /** The index's own claim about this child. Null when it makes none. */
  lastmod: string | null;
}

export interface ParsedSitemap extends ParsedFeed {
  /**
   * Child sitemaps, when this document is an index rather than a list.
   *
   * Large sites split by section and year — /sitemap-news-2026.xml and so
   * on — so the caller fetches a bounded number of these rather than this
   * module recursing on someone else's file and deciding for itself how
   * much of their server to read.
   *
   * ORDERED NEWEST FIRST, AND THAT IS THE WHOLE POINT
   *
   * Italy's Garante publishes 320 of them, on Liferay, named
   * `/sitemap.xml?p_l_id=145219&layoutUuid=37b70650-…`. Nothing in that URL
   * says what is inside it, so the caller's "prefer the one whose name
   * matches the section" heuristic ranked all 320 equally, this module kept
   * the first 40 it happened to parse, and the caller fetched the first 3 of
   * those. The same three, every six hours, out of three hundred and twenty.
   * The Garante was reported as publishing nothing and switched itself off.
   *
   * But the index states a lastmod per child, and the section that publishes
   * decisions is the section that changes. Sorting by it costs no extra
   * request and turns a lottery into a reading. Sorted BEFORE the cap below,
   * or the cap would throw away the answer.
   */
  indexes: SitemapChild[];
}

function decode(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/** An ISO date, or null. Never today's date standing in for an unknown one. */
function isoDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const parsed = new Date(decode(raw));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseSitemap(xml: string, options: SitemapOptions): ParsedSitemap {
  const { itemPattern, baseUrl, maxItems = 60 } = options;

  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return { items: [], skipped: 0, indexes: [] };
  }

  // An index names other sitemaps and contains no pages of its own. Detected
  // by the wrapper element rather than by the presence of <sitemap> blocks,
  // because a malformed file can carry both.
  if (/<sitemapindex\b/i.test(xml)) {
    const indexes: SitemapChild[] = [];
    for (const block of xml.match(SITEMAP_BLOCK) ?? []) {
      const loc = decode(block.match(LOC)?.[1] ?? '');
      try {
        // Same origin: a sitemap index that points at another host is
        // either a CDN we should not be crawling or something worse.
        if (loc && new URL(loc).origin === origin) {
          indexes.push({ url: loc, lastmod: isoDate(block.match(LASTMOD)?.[1]) });
        }
      } catch {
        // Not a URL. Not our problem to repair.
      }
    }

    // Newest first, undated last — a child the index declines to date is not
    // evidence of staleness, but it is not a reason to look there first
    // either. Stable for equal dates, so the site's own order survives.
    indexes.sort((a, b) => (b.lastmod ?? '').localeCompare(a.lastmod ?? ''));

    return { items: [], skipped: 0, indexes: indexes.slice(0, MAX_INDEX_CHILDREN) };
  }

  const items: FeedItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const block of xml.match(URL_BLOCK) ?? []) {
    const loc = decode(block.match(LOC)?.[1] ?? '');
    if (!loc) {
      skipped += 1;
      continue;
    }

    let absolute: URL;
    try {
      absolute = new URL(loc);
    } catch {
      skipped += 1;
      continue;
    }

    if (absolute.origin !== origin) continue;

    const at = absolute.pathname.indexOf(itemPattern);
    if (at === -1) continue;

    // An item lives under the section; it is not the section. The same rule
    // the listing parser needed, for the same reason: a sitemap lists the
    // index page alongside the articles.
    if (absolute.pathname.slice(at + itemPattern.length).replace(/\/+$/, '') === '') continue;

    absolute.hash = '';
    const link = absolute.toString();
    if (seen.has(link)) continue;

    // A sitemap has no titles. The authority's own slug is the only thing
    // here that reads like one, and pass 2 replaces it from the page.
    const title = titleFromSlug(absolute.pathname);
    if (!title) {
      skipped += 1;
      continue;
    }

    seen.add(link);
    items.push({
      externalId: link,
      title,
      link,
      // The regulator's own statement about its own page. Absent or
      // unparseable stays null — the extractor reads the real date off the
      // decision, and a date we guessed would appear on a published page.
      publishedAt: isoDate(block.match(LASTMOD)?.[1]),
      excerpt: null
    });

    if (items.length >= maxItems) break;
  }

  // Newest first when the sitemap says so, so a run that hits the 40-item
  // cap takes the most recent decisions rather than whichever the file
  // happened to list first.
  items.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));

  return { items, skipped, indexes: [] };
}

/**
 * What the sitemap actually contained, for when it yielded no items.
 *
 * `describeFeed` was answering this question for sitemaps, and it counts
 * <item>, <entry> and <channel> — none of which exist in a sitemap. So Oman
 * and Saudi Arabia were both reported as `root <urlset>; no feed tags`,
 * which reads as a broken document and is the opposite of the truth: the
 * file is a perfectly good sitemap of two megabytes, and it is our
 * `item_pattern` that matches nothing in it.
 *
 * Those two failures need opposite repairs — one is "find another URL", the
 * other is "change one string in a table row" — and the report could not
 * tell them apart. It also could not say WHICH string, which is the only
 * thing anybody actually needs, so the fix was a guess per six-hour run
 * from a sandbox that cannot open either site.
 *
 * The prefix census answers it. The pattern that matches the most decision
 * URLs is visible in the output, and the repair stops being a guess.
 */
/**
 * Can we choose among these children at all?
 *
 * Two signals decide it: a name that contains the section we are after, or
 * a lastmod telling us where the site has been writing. Italy's Garante
 * offers neither — 321 children, every URL of the form
 * `/sitemap.xml?p_l_id=<n>&layoutUuid=<uuid>`, and not one carrying a date.
 *
 * I asserted, shipping the lastmod ranking, that "the index states a
 * lastmod for each child". That is true of the sitemap protocol and false
 * of their file, and I inferred it from the standard rather than reading
 * theirs — which this sandbox cannot reach. The ranking sorted 321 nulls.
 *
 * When both signals are absent, fetching three of three hundred and
 * twenty-one is a lottery, and reporting "no items" afterwards says
 * something about the regulator that we have not established. So the
 * caller stops, and the report says we could not search rather than that
 * there was nothing to find.
 */
export function indexIsBlind(children: SitemapChild[], itemPattern: string): boolean {
  if (children.length === 0) return false;
  const token = itemPattern.replace(/^\/|\/$/g, '').split('/').pop() ?? '';
  const named = token.length > 0 && children.some((c) => c.url.includes(token));
  const dated = children.some((c) => c.lastmod !== null);
  return !named && !dated;
}

export function describeSitemap(xml: string, options: SitemapOptions): string {
  let origin: string;
  try {
    origin = new URL(options.baseUrl).origin;
  } catch {
    return 'base_url unparseable';
  }

  if (/<sitemapindex\b/i.test(xml)) {
    const total = (xml.match(SITEMAP_BLOCK) ?? []).length;
    // Through parseSitemap, so what is printed here is the ranking the
    // caller will actually follow rather than the file's own order. Printing
    // the first four in document order said "320 children" and then named
    // four the poller was never going to read.
    const ranked = parseSitemap(xml, options).indexes;
    const shown = ranked
      .slice(0, 3)
      .map((child) => `${child.url}${child.lastmod ? ` (${child.lastmod.slice(0, 10)})` : ' (undated)'}`)
      .join(' ');

    // An index yields no items by design; the caller follows it. Saying so
    // stops this reading as a fault — and naming the dates is what shows
    // whether the ranking has anything to work with. All-undated means the
    // choice is still blind and the repair is a narrower feed_url, not a
    // better heuristic.
    const blind = indexIsBlind(ranked, options.itemPattern)
      ? ' — none dated and none named for this section, so there is no honest way to pick a few of them: the repair is a narrower feed_url, not a better heuristic'
      : '';

    return `sitemap index, ${total} child sitemap(s), newest first${shown ? `: ${shown}` : ''}${blind}`;
  }

  const blocks = xml.match(URL_BLOCK) ?? [];
  const prefixes = new Map<string, number>();
  const deep: string[] = [];
  let sameOrigin = 0;
  let matched = 0;
  let newest: string | null = null;

  for (const block of blocks) {
    const loc = decode(block.match(LOC)?.[1] ?? '');
    let absolute: URL;
    try {
      absolute = new URL(loc);
    } catch {
      continue;
    }
    if (absolute.origin !== origin) continue;
    sameOrigin += 1;

    // Three segments, for the reason the listing census already learned in
    // Brazil: a site whose whole estate lives under /anpd/pt-br/ collapses
    // to one bucket at two, and one bucket is not an answer.
    const segments = absolute.pathname.split('/').filter(Boolean);
    const prefix = `/${segments.slice(0, 3).join('/')}/`;
    prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
    if (segments.length >= 3) deep.push(absolute.pathname);

    if (absolute.pathname.includes(options.itemPattern)) matched += 1;

    const lastmod = isoDate(block.match(LASTMOD)?.[1]);
    if (lastmod && (!newest || lastmod > newest)) newest = lastmod;
  }

  const top = [...prefixes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([path, count]) => `${path}×${count}`)
    .join(' ');

  const parts = [
    `${blocks.length} <url> entr${blocks.length === 1 ? 'y' : 'ies'}, ${sameOrigin} same-origin`,
    top || 'no same-origin URLs'
  ];

  const samples = [...new Set(deep)]
    .sort((a, b) => b.length - a.length)
    .slice(0, 2)
    .join(' ');
  if (samples) parts.push(`deepest: ${samples}`);

  // The line that names the repair. Zero means the file is fine and the
  // pattern is wrong; a positive count with no items means they were all
  // the section's own index page, which is a different bug.
  parts.push(`"${options.itemPattern}" matched ${matched}`);

  // A section whose newest page is four years old is not a watch worth
  // keeping, and no item_pattern will fix that. Absent stays absent — a
  // sitemap without lastmod is common and is not a finding.
  if (newest) parts.push(`newest lastmod ${newest.slice(0, 10)}`);

  return parts.join('; ');
}

/**
 * The sitemaps a site advertises in its own robots.txt.
 *
 * The discovery step that removes the guessing: rather than trying
 * /sitemap.xml and hoping, ask the site where its sitemaps are. robots.txt
 * is served by everything, costs one request, and is the one file on a
 * domain that exists specifically to tell automated clients what to do.
 */
export function sitemapsFromRobots(robots: string, baseUrl: string): string[] {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const line of robots.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (!match) continue;
    try {
      const url = new URL(match[1]!, origin);
      // Same origin, and it has to look like a sitemap. `Sitemap: ::::`
      // resolves to a perfectly valid URL — the constructor accepts almost
      // anything against a base — and would have been reported as a
      // discovery. A finding nobody can act on is worse than no finding.
      const plausible = /sitemap/i.test(url.pathname) || /\.xml(\.gz)?$/i.test(url.pathname);
      if (url.origin === origin && plausible) found.push(url.toString());
    } catch {
      // A malformed Sitemap: line is the site's problem, not a reason to
      // abandon the rest of the file.
    }
  }
  return [...new Set(found)].slice(0, 10);
}
