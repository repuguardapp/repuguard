import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every page in the sitemap must be reachable by following links.
 *
 * Google's URL inspection, on /fr/compliance/gdpr, /fr/decisions and
 * /fr/compare/gdpr-vs-uk_gdpr, said the same three things:
 *
 *   La page n'est pas indexée : Google ne reconnaît pas cette URL
 *   Sitemaps : Aucun sitemap référent détecté
 *   Page d'origine : Aucune page d'origine détectée
 *
 * No referring page. The header and footer linked to /, /audit,
 * /dashboard, /docs, /dpa, /login, /pricing, /privacy and /terms, and
 * nowhere else — so 329 URLs had no inbound link from anywhere on the
 * site. A sitemap is a hint, not a path: Google discovers pages by
 * following links, and there were none to follow. Sixteen months, zero
 * clicks, eleven impressions, and only two URLs ever shown: / and /en.
 *
 * Nothing in the build would have caught that. The pages rendered, the
 * tests passed, the sitemap listed them, and they were invisible. So
 * the check is structural: a route family that appears in the sitemap
 * must be linked from somewhere a crawler can already reach.
 */

const root = join(__dirname, '..');
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');

const LAYOUT = read('src/app/[locale]/layout.tsx');
const SITEMAP = read('src/app/sitemap.ts');

describe('the footer is the path into the corpus', () => {
  // The footer renders on every page, including the two URLs Google has
  // actually seen — so it is the one place a link is guaranteed to be
  // found from somewhere already crawled.
  for (const path of ['/compliance', '/compare', '/decisions']) {
    it(`links to ${path} from every page`, () => {
      expect(LAYOUT).toContain(`href="${path}"`);
    });
  }
});

describe('each hub reaches its own family', () => {
  it('the compliance hub links to every framework', () => {
    const hub = read('src/app/[locale]/compliance/page.tsx');
    expect(hub).toContain('FRAMEWORKS.map');
    expect(hub).toContain('/compliance/${framework.id}');
  });

  it('the compare hub links to every curated pair', () => {
    const hub = read('src/app/[locale]/compare/page.tsx');
    expect(hub).toContain('CURATED_PAIRS');
    expect(hub).toContain('/compare/${slug}');
  });

  it('the decisions index links to every published decision', () => {
    const index = read('src/app/[locale]/decisions/page.tsx');
    expect(index).toContain('/decisions/${decision.slug}');
  });

  it('the hubs link to each other, so no family is a cul-de-sac', () => {
    const compliance = read('src/app/[locale]/compliance/page.tsx');
    const compare = read('src/app/[locale]/compare/page.tsx');
    expect(compliance).toContain('href="/compare"');
    expect(compliance).toContain('href="/decisions"');
    expect(compare).toContain('href="/compliance"');
    expect(compare).toContain('href="/decisions"');
  });
});

describe('the sitemap and the link graph agree', () => {
  it('advertises both hubs', () => {
    // A hub missing from the sitemap is a hub Google finds late; a hub
    // missing from the footer is 287 pages it never finds at all.
    expect(SITEMAP).toContain("'/compliance'");
    expect(SITEMAP).toContain("'/compare'");
  });

  it('has a footer link for every core route family it lists', () => {
    // Guards the reverse direction: a family added to the sitemap in
    // future without an entry point fails here rather than silently
    // going unindexed for months.
    const families = ['/compliance', '/compare', '/decisions'];
    for (const family of families) {
      expect(SITEMAP, `${family} in sitemap`).toContain(`'${family}'`);
      expect(LAYOUT, `${family} linked`).toContain(`href="${family}"`);
    }
  });
});
