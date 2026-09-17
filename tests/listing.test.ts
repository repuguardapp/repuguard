import { describe, expect, it } from 'vitest';
import { describeFeed } from '@/lib/feeds';
import { describeListing, parseListing } from '@/lib/listing';

/**
 * Reading a regulator's news page when it has no feed.
 *
 * The ICO withdrew every one of its RSS feeds; the Gulf authorities
 * never had any; Brazil and Japan publish news pages. A watcher that
 * only speaks RSS is a watcher whose corpus can only ever be European,
 * on a product that sells audits against thirteen frameworks.
 *
 * The page belongs to someone else and changes without telling us, so
 * every test here is about what happens when it does.
 */

const BASE = 'https://ico.org.uk/action-weve-taken/enforcement/';

const PAGE = `
<html><body>
  <nav>
    <a href="/">Home</a>
    <a href="/about/">About the ICO</a>
    <a href="https://twitter.com/ICOnews">Follow us on Twitter</a>
  </nav>
  <main>
    <a href="/action-weve-taken/enforcement/acme-ltd-monetary-penalty/">
      Acme Ltd fined £150,000 for nuisance calls
    </a>
    <a href="/action-weve-taken/enforcement/borough-council-reprimand/">
      <span>Borough Council</span> reprimanded over a data breach
    </a>
    <a href="/action-weve-taken/enforcement/acme-ltd-monetary-penalty/#summary">
      Read more
    </a>
    <a href="/action-weve-taken/enforcement/short/">news</a>
  </main>
  <footer><a href="/privacy-notice/">Privacy notice</a></footer>
</body></html>`;

describe('what becomes an item', () => {
  const { items, skipped } = parseListing(PAGE, {
    itemPattern: '/action-weve-taken/enforcement/',
    baseUrl: BASE
  });

  it('takes the decisions and leaves the furniture', () => {
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe('Acme Ltd fined £150,000 for nuisance calls');
    // Markup inside the anchor is flattened, not left in the title a
    // reviewer reads first in the queue.
    expect(items[1]?.title).toBe('Borough Council reprimanded over a data breach');
  });

  it('resolves relative links against the listing', () => {
    expect(items[0]?.link).toBe(`https://ico.org.uk/action-weve-taken/enforcement/acme-ltd-monetary-penalty/`);
  });

  it('never invents a date', () => {
    // A listing shows "12 September" with no year, or a relative date,
    // or nothing. Pass 2 reads the real date off the decision, and has
    // the rule that a deliberation's own date beats the prose — which
    // is what stopped us publishing a CNIL fine under the wrong one.
    expect(items.every((i) => i.publishedAt === null)).toBe(true);
  });

  it('counts what it refused rather than guessing', () => {
    // "news" is four characters: an anchor with no usable title, which
    // is what "Read more" and an image link look like.
    expect(skipped).toBeGreaterThan(0);
  });
});

describe('what it refuses to follow', () => {
  it('ignores another origin', () => {
    // A regulator's page links to Twitter, to EUR-Lex, to a PDF on
    // another ministry's server. Following those fills the queue with
    // things nobody asked us to watch.
    const { items } = parseListing(
      `<a href="https://evil.test/action-weve-taken/enforcement/x-fined-today/">Something that looks right</a>`,
      { itemPattern: '/action-weve-taken/enforcement/', baseUrl: BASE }
    );
    expect(items).toEqual([]);
  });

  it('treats /x#summary and /x as one decision', () => {
    // Publishing the same sanction twice under two URLs is the failure
    // the cross-source dedup already exists to prevent; a fragment
    // must not reintroduce it.
    const links = parseListing(PAGE, {
      itemPattern: '/action-weve-taken/enforcement/',
      baseUrl: BASE
    }).items.map((i) => i.link);
    expect(new Set(links).size).toBe(links.length);
    expect(links.some((l) => l.includes('#'))).toBe(false);
  });

  it('caps what one page can enqueue', () => {
    const many = Array.from(
      { length: 200 },
      (_, i) => `<a href="/enf/decision-number-${i}/">Decision number ${i} against a company</a>`
    ).join('');
    const { items } = parseListing(many, { itemPattern: '/enf/', baseUrl: 'https://x.test/enf/', maxItems: 60 });
    expect(items).toHaveLength(60);
  });

  it('returns nothing rather than throwing on a broken base', () => {
    expect(parseListing(PAGE, { itemPattern: '/x/', baseUrl: 'not a url' })).toEqual({
      items: [],
      skipped: 0
    });
  });
});

describe('the page changed under us', () => {
  it('yields nothing when the pattern stops matching', () => {
    // The regulator reorganised their URLs. Zero items is what the
    // caller turns into a source failure — which is the point: a
    // listing that silently matches nothing is how a dead source stays
    // dead for months.
    const { items } = parseListing(PAGE, { itemPattern: '/enforcement-actions/', baseUrl: BASE });
    expect(items).toEqual([]);
  });

  it('survives an error page served with a 200', () => {
    const { items } = parseListing('<html><body><h1>Service unavailable</h1></body></html>', {
      itemPattern: '/x/',
      baseUrl: BASE
    });
    expect(items).toEqual([]);
  });

  it('decodes entities in a title', () => {
    const { items } = parseListing(
      `<a href="/enf/a-decision/">Soci&#233;t&#233; X fined &amp; reprimanded by the authority</a>`,
      { itemPattern: '/enf/', baseUrl: 'https://x.test/' }
    );
    expect(items[0]?.title).toBe('Société X fined & reprimanded by the authority');
  });
});

describe('when it yields nothing, it says what was on the page', () => {
  /**
   * Four of nine sources failed on the first real run and the errors —
   * `no_items (skipped 8, 138832 bytes)` — could not be acted on. They do
   * not distinguish a pattern that matches nothing from a pattern that
   * matches links whose anchors carry no text, and those need opposite
   * repairs. The only other way to find out was to open the regulator's
   * page by hand, which the build sandbox cannot reach: every one of those
   * sources would have stayed dead until somebody happened to look.
   */

  it('names the sections it found, so a pattern can be chosen from the error alone', () => {
    const seen = describeListing(PAGE, {
      itemPattern: '/nothing-matches-this/',
      baseUrl: BASE
    });
    expect(seen).toContain('/action-weve-taken/enforcement/');
    expect(seen).toContain('same-origin links');
  });

  it('distinguishes "matched nothing" from "matched, but the anchors are empty"', () => {
    // AEPD's failure exactly: eight links matched and every one was
    // refused for having no usable title. Without this the two read the
    // same in the error message.
    const seen = describeListing(PAGE, {
      itemPattern: '/action-weve-taken/enforcement/',
      baseUrl: BASE
    });
    expect(seen).toContain('pattern matched, no title');
    expect(seen).toContain('"news"');
  });

  it('says so plainly when nothing on the page is ours', () => {
    const seen = describeListing('<a href="https://x.test/a-page/">Elsewhere entirely</a>', {
      itemPattern: '/x/',
      baseUrl: BASE
    });
    expect(seen).toContain('no same-origin links');
  });

  it('tells a feed that became a web page from a feed that is empty', () => {
    // The Garante failure: 88KB fetched from a URL declared as RSS, zero
    // items. A moved feed serving HTML and a genuinely quiet regulator
    // are indistinguishable by byte count.
    expect(describeFeed('<?xml version="1.0"?><rss><channel></channel></rss>')).toContain('channel');
    // A consent wall served with a 200 from a URL we call RSS names
    // itself: root <html>, and not an <item> in sight.
    const wall = describeFeed('<!doctype html><html><body>Consent required</body></html>');
    expect(wall).toContain('root <html>');
    expect(wall).not.toContain('item');
    expect(describeFeed('<feed><entry/><entry/></feed>')).toContain('entry×2');
  });
});
