import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 427 URLs that Google found and never fetched.
 *
 * Search Console, 21 October: 13 indexed, 429 not. Of those 429, exactly
 * one was "Crawled – currently not indexed" — read and turned down — and
 * 427 were "Discovered – currently not indexed": the URL is known, the
 * page has never been requested. That is a crawl-budget verdict, not a
 * judgement on the writing, and only one page has been judged at all.
 *
 * The cause was the link graph. Decision pages pointed out to framework
 * pages; framework pages pointed back at nothing. So each of the 252
 * decision URLs had exactly one internal inbound link, from the
 * /decisions hub, on a domain with no external links worth the name.
 *
 * These assertions hold the arrow in both directions. They do not prove
 * the pages get indexed — nothing in this repository can promise that —
 * only that the path exists for a crawler to follow.
 *
 * AND THEY DO NOT EVEN PROVE THAT. READ THIS BEFORE ADDING ONE.
 *
 * Every assertion below reads a .tsx file and checks that a string
 * occurs in it. That is not the link graph; it is the source code that
 * is supposed to produce the link graph. The two parted company on
 * 23 October, while this file was green: the framework pages were
 * emitting links to thirteen comparison pages that had never been
 * generated — 91 URLs over seven locales, all 404, all linked from the
 * family with the most inbound links we have. The href in the template
 * was present and correct, so nothing here could see it, because what
 * was wrong was the value interpolated into it.
 *
 * `e2e/link-graph.spec.ts` is the instrument for that class: it fetches
 * the running site, parses the HTML that was served, follows every
 * internal link and reports where each one lands. It was shown to fail
 * on the broken build before being trusted on the fixed one.
 *
 * Keep these tests — prerendering and `dynamicParams` are build-time
 * properties a crawl cannot observe. Do not add a new `toContain` on an
 * href here and believe the graph is covered.
 */

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const FRAMEWORK_PAGE = read('src/app/[locale]/compliance/[framework]/page.tsx');
const DECISION_PAGE = read('src/app/[locale]/decisions/[slug]/page.tsx');

describe('the link graph runs both ways', () => {
  it('a framework page links to decision pages', () => {
    expect(FRAMEWORK_PAGE).toContain('href={`/decisions/${d.slug}`}');
  });

  it('a decision page still links to framework pages', () => {
    // The direction that already worked. Breaking it to add the other
    // would trade one orphan family for another.
    expect(DECISION_PAGE).toContain('href={`/compliance/${framework.id}`}');
  });

  it('a framework page also links to the decisions hub', () => {
    // A crawler that reaches one framework page can walk to every
    // decision from there, not only to the dozen listed.
    expect(FRAMEWORK_PAGE).toContain('href="/decisions"');
  });
});

describe('the decision pages are prerendered', () => {
  it('enumerates its slugs at build', () => {
    // The only programmatic family that lacked this. Every cold URL
    // meant a database round trip before a byte of HTML, on the 252
    // pages that most needed Googlebot to find them cheap.
    expect(DECISION_PAGE).toContain('export async function generateStaticParams()');
    expect(DECISION_PAGE).toContain('listPublishedSlugs()');
  });

  it('does not close the door behind them', () => {
    /**
     * `dynamicParams` must stay at its default of true. The
     * localisation cron publishes four more decisions every six hours;
     * setting it false would 404 every one of them until the next
     * deploy, which is a worse failure than a slow first render and a
     * silent one.
     */
    expect(DECISION_PAGE).not.toMatch(/dynamicParams\s*=\s*false/);
  });

  it('keeps revalidation, so a published edit is not frozen until deploy', () => {
    expect(DECISION_PAGE).toMatch(/revalidate\s*=\s*\d+/);
  });
});

describe('an unreadable list never reads as an empty one', () => {
  it('says so instead of printing nothing', () => {
    /**
     * "No decisions under the GDPR" is a confident false statement
     * about the law, on a page that exists to be trusted about the
     * law. The null branch prints decisions.unavailable, which already
     * says the connection failed rather than that nothing exists.
     */
    expect(FRAMEWORK_PAGE).toContain('decisions === null');
    expect(FRAMEWORK_PAGE).toContain("tDecisions('unavailable')");
  });

  it('renders nothing at all when the corpus genuinely holds none', () => {
    // Several frameworks have no enforcement in our corpus yet. A
    // heading over an empty list is a weak section on a page we want
    // crawled, and claims nothing useful.
    expect(FRAMEWORK_PAGE).toContain('decisions.length > 0');
  });
});

describe('the section invents no copy', () => {
  const LOCALES = readdirSync(join(ROOT, 'messages'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));

  it('reuses keys that exist in all seven locales', () => {
    /**
     * `decisions.indexTitle` and `decisions.unavailable` were written
     * for the hub and are already translated. Nothing had to be
     * authored to put this section on 105 prerendered pages, and no
     * locale renders a latin key in place of a heading.
     */
    expect(LOCALES).toHaveLength(7);
    for (const locale of LOCALES) {
      const d = JSON.parse(read(join('messages', `${locale}.json`))).decisions;
      expect(d?.indexTitle, `${locale}.decisions.indexTitle`).toBeTruthy();
      expect(d?.unavailable, `${locale}.decisions.unavailable`).toBeTruthy();
    }
  });
});
