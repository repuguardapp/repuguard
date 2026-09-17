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

describe('a decision whose only link says "Leer más"', () => {
  /**
   * The AEPD publishes exactly that way: the headline sits in a heading
   * and the sole link to the decision is the words "Leer más". Eight
   * decisions on the page, eight links found, eight refused — the source
   * reported "no items" while working perfectly.
   *
   * Refusing an entire national regulator over the wording of its anchors
   * is the wrong trade, so the URL the authority itself chose becomes a
   * provisional title. It is not invented: pass 2 reads the decision page
   * and replaces it. Its only job is to make the row recognisable in the
   * review queue.
   */

  const AEPD = `
    <a href="/prensa-y-comunicacion/notas-de-prensa/la-aepd-sanciona-a-una-empresa-por-videovigilancia/">Leer más</a>
    <a href="/prensa-y-comunicacion/notas-de-prensa/">Notas de prensa</a>`;

  it('falls back to the regulator’s own slug', () => {
    const { items } = parseListing(AEPD, {
      itemPattern: '/notas-de-prensa/',
      baseUrl: 'https://www.aepd.es/es/prensa-y-comunicacion/notas-de-prensa'
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('La aepd sanciona a una empresa por videovigilancia');
  });

  it('still refuses a slug that tells a reviewer nothing', () => {
    // '/enforcement/short/' yields "short". A bad provisional title is
    // worse than a skipped item, so it stays skipped and stays counted.
    const { items, skipped } = parseListing(PAGE, {
      itemPattern: '/action-weve-taken/enforcement/',
      baseUrl: BASE
    });
    expect(items.map((i) => i.link)).not.toContain(`${BASE}short/`);
    expect(skipped).toBeGreaterThan(0);
  });

  it('never turns a date path into a headline', () => {
    const { items } = parseListing(`<a href="/news/2026/09/17/">▶</a>`, {
      itemPattern: '/news/',
      baseUrl: 'https://x.test/news/'
    });
    expect(items).toEqual([]);
  });

  it('shows whole paths, not only prefixes, when every link shares one', () => {
    // Brazil's failure: 59 links all under /anpd/pt-br/ collapsed into a
    // single bucket, which is the shape of the answer and not the answer.
    const seen = describeListing(
      `<a href="/anpd/pt-br/assuntos/noticias/uma-decisao-da-anpd/">Uma decisão</a>`,
      { itemPattern: '/nope/', baseUrl: 'https://www.gov.br/anpd/pt-br/assuntos/noticias' }
    );
    expect(seen).toContain('deepest: /anpd/pt-br/assuntos/noticias/uma-decisao-da-anpd/');
  });
});

describe('the section is not one of its own decisions', () => {
  it('refuses the listing page’s link back to itself', () => {
    // Found by the test above rather than in production: the AEPD page's
    // own "Notas de prensa" link matches the item pattern and carries a
    // perfectly good title, so it would have arrived in the review queue
    // as a sanction. Every regulator links back to the index it is
    // showing you.
    const { items } = parseListing(
      `<a href="/prensa-y-comunicacion/notas-de-prensa/">Notas de prensa</a>
       <a href="/prensa-y-comunicacion/notas-de-prensa">Notas de prensa</a>
       <a href="/prensa-y-comunicacion/notas-de-prensa/la-aepd-sanciona-a-una-empresa/">Leer más</a>`,
      {
        itemPattern: '/notas-de-prensa/',
        baseUrl: 'https://www.aepd.es/es/prensa-y-comunicacion/notas-de-prensa'
      }
    );
    expect(items.map((i) => i.link)).toEqual([
      'https://www.aepd.es/prensa-y-comunicacion/notas-de-prensa/la-aepd-sanciona-a-una-empresa/'
    ]);
  });
});

describe('the ICO collected its own skip link for months', () => {
  /**
   * Ground truth from production, not a hypothesis. The whole of what the
   * ICO source ever discovered, across every run since it shipped, was a
   * single row:
   *
   *   https://ico.org.uk/action-weve-taken/enforcement/
   *   raw_title: "Skip to main content"
   *
   * The accessibility skip link. `href="#main-content"` resolved against
   * the listing to the listing itself, and "Skip to main content" is
   * twenty characters, so it passed the title check and became an item —
   * one item, which is all `ok` requires. The United Kingdom has been
   * green on the operations page and empty in the database.
   *
   * The failure is not the parse. It is that one usable-looking item is
   * indistinguishable from a working source.
   */

  const ICO = `
    <a href="#main-content">Skip to main content</a>
    <a href="#top">Back to top</a>
    <a href="/action-weve-taken/enforcement/">Enforcement action we have taken</a>`;

  it('takes neither the skip link, nor the section, nor anything else here', () => {
    const { items } = parseListing(ICO, {
      itemPattern: '/action-weve-taken/enforcement/',
      baseUrl: 'https://ico.org.uk/action-weve-taken/enforcement/'
    });
    // Zero is the honest answer, and zero is what turns the source red.
    expect(items).toEqual([]);
  });

  it('still reads a real decision on the same page', () => {
    const { items } = parseListing(
      `${ICO}<a href="/action-weve-taken/enforcement/acme-ltd-monetary-penalty/">Acme Ltd fined for nuisance calls</a>`,
      {
        itemPattern: '/action-weve-taken/enforcement/',
        baseUrl: 'https://ico.org.uk/action-weve-taken/enforcement/'
      }
    );
    expect(items.map((i) => i.title)).toEqual(['Acme Ltd fined for nuisance calls']);
  });
});
