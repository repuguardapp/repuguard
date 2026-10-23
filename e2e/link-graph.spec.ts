import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Walk every internal link from the homepage and check where it lands.
 *
 * WHY THIS EXISTS
 *
 * `tests/crawl-graph.test.ts` guards the internal link graph — the one
 * mechanism the indexation target depends on — like this:
 *
 *   expect(FRAMEWORK_PAGE).toContain('href={`/decisions/${d.slug}`}');
 *
 * That asserts a string is present in a .tsx file. It stays green while
 * the link it describes points at nothing, while a guard above it stops
 * the block rendering, and while the array it maps over is empty.
 *
 * It was green on 23 October, when the framework pages were linking to
 * thirteen comparison pages that did not exist — 91 URLs over seven
 * locales, every one answering 404, every one linked from the family
 * with the most inbound links on the site. On a domain where 427 URLs
 * are "Discovered – currently not indexed", a crawler walking in from
 * our strongest pages was spending its budget on 404s.
 *
 * Nothing in the repository could have found that, because nothing
 * asked the running site. This does: it fetches, parses the HTML that
 * was actually served, and follows what it finds.
 *
 * WHAT IT CANNOT SEE
 *
 * The suite runs without secrets, so `/decisions` serves an empty hub
 * and no decision detail page is reachable here. The decision family is
 * therefore NOT covered — stated rather than implied, because a crawl
 * that silently covers less than it appears to is worse than no crawl.
 * Pages behind the login wall are out of reach for the same reason.
 */

const START = '/en';

/**
 * A ceiling, so a routing change that makes the graph infinite fails
 * here instead of hanging CI. Hitting it is itself a failure: a crawl
 * that stopped early and passed would be an absence reported as a
 * success.
 *
 * Measured on 23 October: the graph reachable from /en is 792 pages and
 * reads in about 21 seconds — 231 comparison pages (33 curated pairs ×
 * 7 locales), 105 framework pages (15 × 7), the static families, and
 * the `?framework=` variants of /audit. 1200 is headroom for a family
 * or two, not for a combinatorial explosion, which is the thing this
 * number exists to catch.
 */
const MAX_PAGES = 1200;

interface Page {
  status: number;
  links: string[];
  html: boolean;
}

const internal = (href: string, from: string, origin: string): string | null => {
  if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return null;
  let u: URL;
  try {
    u = new URL(href, origin + from);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null;
  u.hash = '';
  return u.pathname + (u.search || '');
};

async function crawl(request: APIRequestContext, origin: string) {
  const pages = new Map<string, Page>();
  const inbound = new Map<string, Set<string>>();
  const queue: string[] = [START];

  while (queue.length > 0 && pages.size < MAX_PAGES) {
    const path = queue.shift()!;
    if (pages.has(path)) continue;

    const res = await request.get(origin + path, { maxRedirects: 0, failOnStatusCode: false });
    const status = res.status();
    const type = res.headers()['content-type'] ?? '';
    const isHtml = type.includes('text/html');

    if (status >= 300 && status < 400) {
      // A guard sending an anonymous visitor to /login is correct
      // behaviour, not a broken link. Follow one hop and judge where it
      // actually lands.
      const to = internal(res.headers()['location'] ?? '', path, origin);
      pages.set(path, { status, links: to ? [to] : [], html: false });
      if (to && !pages.has(to)) queue.push(to);
      continue;
    }

    if (!isHtml) {
      pages.set(path, { status, links: [], html: false });
      continue;
    }

    const body = await res.text();
    const links = [
      ...new Set(
        [...body.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)]
          .map((m) => internal(m[1]!, path, origin))
          .filter((p): p is string => p !== null)
      )
    ];

    pages.set(path, { status, links, html: true });

    for (const l of links) {
      if (!inbound.has(l)) inbound.set(l, new Set());
      inbound.get(l)!.add(path);
      if (!pages.has(l)) queue.push(l);
    }
  }

  return { pages, inbound, exhausted: queue.length === 0 };
}

test.describe('the internal link graph', () => {
  // One crawl, several assertions about it.
  test('leads nowhere that answers 4xx or 5xx', async ({ request, baseURL }) => {
    test.slow();
    const origin = new URL(baseURL!).origin;
    const { pages, inbound, exhausted } = await crawl(request, origin);

    // Measured, not assumed: if the ceiling stopped us, say so and fail
    // rather than report a clean graph we did not finish reading.
    expect(
      exhausted,
      `crawl hit the ${MAX_PAGES}-page ceiling and did not finish; the graph was not fully read`
    ).toBe(true);

    expect(pages.size, 'crawled suspiciously few pages — did the homepage render?').toBeGreaterThan(
      50
    );

    const broken = [...pages.entries()]
      .filter(([, p]) => p.status >= 400)
      .map(([path, p]) => `${p.status} ${path}  <- linked from ${[...(inbound.get(path) ?? [])].join(', ')}`);

    expect(broken, `internal links to pages that do not resolve:\n${broken.join('\n')}`).toEqual([]);
  });

  test('offers every framework page a comparison that resolves', async ({ request, baseURL }) => {
    /**
     * The specific shape of the 23 October defect, asserted against the
     * served HTML rather than against the helper that now prevents it.
     * `tests/seo-pairs.test.ts` holds the data rule; this holds the
     * rendering, and the defect lived in the gap between the two.
     */
    const origin = new URL(baseURL!).origin;
    const hub = await request.get(`${origin}/en/compliance`);
    expect(hub.ok()).toBe(true);

    const frameworks = [
      ...new Set(
        [...(await hub.text()).matchAll(/href="\/en\/compliance\/([a-z0-9_]+)"/g)].map((m) => m[1]!)
      )
    ];
    expect(frameworks.length, 'the compliance hub listed no framework pages').toBeGreaterThan(5);

    const failures: string[] = [];
    for (const id of frameworks) {
      const res = await request.get(`${origin}/en/compliance/${id}`);
      const pairs = [
        ...new Set(
          [...(await res.text()).matchAll(/href="\/en\/compare\/([a-z0-9_-]+)"/g)].map((m) => m[1]!)
        )
      ];
      if (pairs.length === 0) failures.push(`${id} offers no comparison at all`);
      for (const pair of pairs) {
        const got = await request.get(`${origin}/en/compare/${pair}`, { failOnStatusCode: false });
        if (got.status() !== 200) failures.push(`${id} -> /en/compare/${pair} = ${got.status()}`);
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('gives every page it serves a way onward', async ({ request, baseURL }) => {
    /**
     * A dead end is where a visitor stops and where a crawler turns
     * back. Two of the five funnel defects found by hand in October were
     * of exactly this shape — a scan result with nothing to click and a
     * free trial nothing linked to.
     */
    const origin = new URL(baseURL!).origin;
    const { pages } = await crawl(request, origin);

    const deadEnds = [...pages.entries()]
      .filter(([, p]) => p.status === 200 && p.html && p.links.length === 0)
      .map(([path]) => path);

    expect(deadEnds, `pages a visitor cannot leave by clicking:\n${deadEnds.join('\n')}`).toEqual(
      []
    );
  });
});
