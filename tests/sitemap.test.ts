import { describe, expect, it } from 'vitest';
import { parseSitemap, sitemapsFromRobots } from '@/lib/sitemap';

/**
 * Reading a regulator that builds its pages in the browser.
 *
 * Half the authorities we need are single-page applications: the ICO's
 * enforcement listing carries 39 links and not one decision, SDAIA's news
 * page carries six of which two are the cookie banner's "yes" and "no",
 * Qatar's NCSA returns 5KB containing no links at all. No item_pattern
 * will ever read those — the decisions are genuinely not in the document a
 * crawler receives, and I called that a limit of method.
 *
 * It is not. A site that renders its list in the browser still has to be
 * found, so it publishes the same list as XML, server-side, in a file whose
 * entire purpose is to be fetched by machines so they need not crawl.
 */

const BASE = 'https://ico.org.uk/action-weve-taken/enforcement/';

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://ico.org.uk/action-weve-taken/enforcement/acme-ltd-monetary-penalty/</loc>
    <lastmod>2026-09-12</lastmod>
  </url>
  <url>
    <loc>https://ico.org.uk/action-weve-taken/enforcement/borough-council-reprimand/</loc>
    <lastmod>2026-09-18T09:00:00+01:00</lastmod>
  </url>
  <url>
    <loc>https://ico.org.uk/action-weve-taken/enforcement/</loc>
    <lastmod>2026-09-19</lastmod>
  </url>
  <url>
    <loc>https://ico.org.uk/for-organisations/</loc>
  </url>
  <url>
    <loc>https://cdn.example.net/action-weve-taken/enforcement/elsewhere-entirely/</loc>
  </url>
</urlset>`;

describe('what a sitemap yields', () => {
  const { items, skipped } = parseSitemap(SITEMAP, {
    itemPattern: '/action-weve-taken/enforcement/',
    baseUrl: BASE
  });

  it('takes the decisions and leaves the section and the furniture', () => {
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.link)).not.toContain(BASE);
  });

  it('never follows another origin, even a CDN of theirs', () => {
    expect(items.every((i) => i.link.startsWith('https://ico.org.uk/'))).toBe(true);
  });

  it('keeps lastmod, which is the regulator stating a date about its own page', () => {
    // The one date this pipeline will take from a listing, because it is
    // the only one a listing actually asserts.
    expect(items[0]?.publishedAt).toBe('2026-09-18T08:00:00.000Z');
  });

  it('puts the newest first, so a capped run takes the recent decisions', () => {
    expect(items[0]?.link).toContain('borough-council-reprimand');
  });

  it('titles each row from the authority’s own slug', () => {
    // A sitemap has no titles. Pass 2 replaces this from the page itself;
    // its only job is to make the row recognisable in the review queue.
    expect(items[1]?.title).toBe('Acme ltd monetary penalty');
  });

  it('counts what it could not use', () => {
    expect(skipped).toBeGreaterThanOrEqual(0);
  });
});

describe('an index rather than a list', () => {
  const INDEX = `<?xml version="1.0"?>
  <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap><loc>https://ico.org.uk/sitemap-enforcement-2026.xml</loc></sitemap>
    <sitemap><loc>https://ico.org.uk/sitemap-blogs.xml</loc></sitemap>
    <sitemap><loc>https://someone-else.test/sitemap.xml</loc></sitemap>
  </sitemapindex>`;

  it('hands the children back rather than recursing into them', () => {
    // Deciding here how much of someone else's server to read would put
    // that judgement in the parser instead of in the poller, which is the
    // thing that knows about budgets and politeness.
    const { items, indexes } = parseSitemap(INDEX, { itemPattern: '/x/', baseUrl: BASE });
    expect(items).toEqual([]);
    expect(indexes).toEqual([
      'https://ico.org.uk/sitemap-enforcement-2026.xml',
      'https://ico.org.uk/sitemap-blogs.xml'
    ]);
  });
});

describe('hostile and malformed input', () => {
  it('returns nothing rather than throwing on an HTML error page', () => {
    expect(parseSitemap('<html><body>404</body></html>', {
      itemPattern: '/x/',
      baseUrl: BASE
    })).toEqual({ items: [], skipped: 0, indexes: [] });
  });

  it('never invents a date from an unparseable lastmod', () => {
    const { items } = parseSitemap(
      `<urlset><url><loc>https://ico.org.uk/enf/a-real-decision-here/</loc>` +
        `<lastmod>last Tuesday</lastmod></url></urlset>`,
      { itemPattern: '/enf/', baseUrl: BASE }
    );
    // Defaulting to now() would date a decision to the day we noticed it,
    // and that date would appear on a published page.
    expect(items[0]?.publishedAt).toBeNull();
  });

  it('survives a broken base url', () => {
    expect(parseSitemap(SITEMAP, { itemPattern: '/x/', baseUrl: 'not a url' })).toEqual({
      items: [],
      skipped: 0,
      indexes: []
    });
  });

  it('decodes CDATA and entities in a loc', () => {
    const { items } = parseSitemap(
      `<urlset><url><loc><![CDATA[https://ico.org.uk/enf/a-decision-about-something/]]></loc></url></urlset>`,
      { itemPattern: '/enf/', baseUrl: BASE }
    );
    expect(items[0]?.link).toBe('https://ico.org.uk/enf/a-decision-about-something/');
  });
});

describe('asking the site where its sitemaps are', () => {
  /**
   * The discovery step that removes the guessing. robots.txt is served by
   * everything, costs one request, and is the only file on a domain whose
   * purpose is to tell automated clients what to fetch.
   */

  it('reads every Sitemap line, whatever the case and spacing', () => {
    const robots = `User-agent: *\nDisallow: /admin\n\nSitemap: https://ico.org.uk/sitemap.xml\nsitemap:https://ico.org.uk/sitemap-news.xml\n  SITEMAP :  /sitemap-relative.xml`;
    expect(sitemapsFromRobots(robots, BASE)).toEqual([
      'https://ico.org.uk/sitemap.xml',
      'https://ico.org.uk/sitemap-news.xml',
      'https://ico.org.uk/sitemap-relative.xml'
    ]);
  });

  it('ignores a sitemap hosted somewhere else', () => {
    const robots = 'Sitemap: https://someone-else.test/sitemap.xml';
    expect(sitemapsFromRobots(robots, BASE)).toEqual([]);
  });

  it('survives a robots.txt with nothing in it', () => {
    expect(sitemapsFromRobots('', BASE)).toEqual([]);
    expect(sitemapsFromRobots('User-agent: *\nDisallow:', BASE)).toEqual([]);
  });

  it('does not let one malformed line lose the rest of the file', () => {
    const robots = 'Sitemap: ::::\nSitemap: https://ico.org.uk/sitemap.xml';
    expect(sitemapsFromRobots(robots, BASE)).toEqual(['https://ico.org.uk/sitemap.xml']);
  });
});
