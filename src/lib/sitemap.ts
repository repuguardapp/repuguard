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

export interface SitemapOptions {
  /** A substring every decision URL's path contains. */
  itemPattern: string;
  /** Bounds which URLs may be taken, and resolves nothing — locs are absolute. */
  baseUrl: string;
  maxItems?: number;
}

export interface ParsedSitemap extends ParsedFeed {
  /**
   * Child sitemaps, when this document is an index rather than a list.
   *
   * Large sites split by section and year — /sitemap-news-2026.xml and so
   * on — so the caller fetches a bounded number of these rather than this
   * module recursing on someone else's file and deciding for itself how
   * much of their server to read.
   */
  indexes: string[];
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
    const indexes: string[] = [];
    for (const block of xml.match(SITEMAP_BLOCK) ?? []) {
      const loc = decode(block.match(LOC)?.[1] ?? '');
      try {
        // Same origin: a sitemap index that points at another host is
        // either a CDN we should not be crawling or something worse.
        if (loc && new URL(loc).origin === origin) indexes.push(loc);
      } catch {
        // Not a URL. Not our problem to repair.
      }
    }
    return { items: [], skipped: 0, indexes: indexes.slice(0, 40) };
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
export function describeSitemap(xml: string, options: SitemapOptions): string {
  let origin: string;
  try {
    origin = new URL(options.baseUrl).origin;
  } catch {
    return 'base_url unparseable';
  }

  if (/<sitemapindex\b/i.test(xml)) {
    const children = xml.match(SITEMAP_BLOCK) ?? [];
    const names = children
      .slice(0, 4)
      .map((block) => decode(block.match(LOC)?.[1] ?? ''))
      .filter(Boolean)
      .join(' ');
    // An index yields no items by design; the caller follows it. Saying so
    // stops this reading as a fault.
    return `sitemap index, ${children.length} child sitemap(s)${names ? `: ${names}` : ''}`;
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
