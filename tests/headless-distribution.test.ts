import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// indexnow.ts is server-only, like every module that touches a secret
// or an outbound call. The rule it enforces is testable without a
// server; the import guard is not.
vi.mock('server-only', () => ({}));
import { NATIVE_LOCALE_CODES } from '@/i18n/locales';
import { FRAMEWORKS } from '@/lib/legal-frameworks';
import { softwareApplicationSchema } from '@/lib/product-schema';
import { INDEXNOW_KEY, indexNowKeyPath } from '@/lib/indexnow';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('the product markup states nothing it cannot support', () => {
  const schema = softwareApplicationSchema('https://lexyflow.com', 'A description.');

  it('carries no rating and no reviews', () => {
    /**
     * Google's structured-data report asks for `aggregateRating` and
     * `review` on this type and will keep asking. Supplying them means
     * inventing ratings for a product with no customers. The same
     * request was refused once already and the markup came off rather
     * than being filled — that is the precedent, not a preference.
     */
    const json = JSON.stringify(schema);
    expect(json).not.toContain('aggregateRating');
    expect(json).not.toContain('"review"');
    expect(json).not.toContain('ratingValue');
  });

  it('carries no price, because prices live in Stripe', () => {
    // Per-currency, changed there without changing here. A price in
    // markup is a claim that drifts silently into being false.
    expect(JSON.stringify(schema)).not.toContain('"offers"');
  });

  it('counts the languages instead of asserting a number', () => {
    /**
     * The homepage said "six native languages" in five of its seven
     * translations while the Arabic one correctly said seven. Nothing
     * caught it because the sentence was hand-written in each file.
     * Anything countable in the markup is counted.
     */
    expect(schema.inLanguage).toEqual([...NATIVE_LOCALE_CODES]);
    expect(schema.inLanguage).toHaveLength(7);
  });

  it('counts the frameworks the same way', () => {
    expect(schema.featureList).toHaveLength(FRAMEWORKS.length);
  });
});

describe('the homepage agrees with itself across its own languages', () => {
  it('does not claim six native languages anywhere', () => {
    /**
     * Found on 22 October: en, fr, de, es, pt-br and ja all said six;
     * ar said seven and was the only correct one. A product that sells
     * accuracy cannot miscount its own feature in five languages.
     *
     * The assertion is on the number, not on a word, so it survives
     * rewording and catches the next drift in any locale.
     */
    const wrong: string[] = [];
    for (const file of readdirSync(join(ROOT, 'messages')).filter((f) => f.endsWith('.json'))) {
      const body: string = JSON.parse(read(join('messages', file))).home.features.global.body;
      // Six in every language this product ships, plus the numeral.
      if (/\b(six|seis|sechs|6)\b/i.test(body) || body.includes('ستة')) wrong.push(file);
    }
    expect(wrong).toEqual([]);
  });
});

describe('nothing on the homepage counts the locales by hand', () => {
  const home = read('src/app/[locale]/page.tsx');

  it('derives the native-language tile from the locale list', () => {
    /**
     * The tile read a hardcoded '6' while the product shipped seven,
     * and the "additional languages" figure subtracted the same 6 — so
     * two numbers were wrong on the most-visited page, in every
     * language, beside prose that was wrong in five of seven. One true
     * source existed the whole time and nothing read from it.
     */
    expect(home).toContain('const nativeCount = NATIVE_LOCALE_CODES.length;');
    expect(home).toContain('value: String(nativeCount)');
    expect(home).toContain('available - nativeCount');
  });

  it('leaves no bare locale count in the component', () => {
    // Behaviour, not a lexeme: the Stats items must not contain a
    // literal digit where a count belongs.
    const stats = home.slice(home.indexOf('const items = ['), home.indexOf('];', home.indexOf('const items = [')));
    expect(stats).not.toMatch(/value: ['`]\d/);
  });
});

describe('llms.txt is derived, not typed out', () => {
  const route = read('src/app/llms.txt/route.ts');

  it('counts rather than hardcodes', () => {
    expect(route).toContain('${FRAMEWORKS.length}');
    expect(route).toContain('${NATIVE_LOCALE_CODES.length}');
  });

  it('says what the site will not claim', () => {
    // No ratings, no customer counts, nothing about a named
    // organisation a regulator has not published first.
    expect(route).toContain('no ratings and no customer counts');
  });

  it('records that the site currently blocks the agents it addresses', () => {
    /**
     * robots.ts disallows OAI-SearchBot, ChatGPT-User and
     * PerplexityBot, which are retrieval agents rather than training
     * crawlers. Shipping a file for an audience we turn away is a
     * tension worth writing down rather than discovering later.
     */
    expect(route).toContain('RETRIEVAL agents');
  });
});

describe('IndexNow submits where submitting is invited', () => {
  const lib = read('src/lib/indexnow.ts');

  it('serves the key as a static file, not a route', () => {
    /**
     * The first version was app/[key].txt/route.ts and it never
     * answered: `[locale]` matched first, Next took the key for a
     * language and served the 404 page. IndexNow would have refused
     * every submission silently.
     *
     * The old test asserted that route's SOURCE TEXT — the comparison
     * and the 404 branch — and passed while the path was unreachable.
     * This one asserts the artefact that is actually served, and that
     * its contents are the key itself, which is what the protocol
     * checks.
     */
    const served = read(join('public', `${INDEXNOW_KEY}.txt`)).trim();
    expect(served).toBe(INDEXNOW_KEY);
  });

  it('points the engines at the path it actually serves', () => {
    expect(indexNowKeyPath()).toBe(`/${INDEXNOW_KEY}.txt`);
    expect(lib).toContain('keyLocation: `${base}${indexNowKeyPath()}`');
  });

  it('never throws into the publication run', () => {
    // It is called after the rows are written. A search engine being
    // unreachable is not a failed publication.
    expect(lib).toContain('catch (err)');
    expect(lib).not.toMatch(/throw new Error\(`?(?!unusable)/);
  });

  it('says plainly that Google does not participate', () => {
    /**
     * The whole bet of the week is 427 Google URLs moving from
     * "Discovered" to "Crawled". IndexNow touches none of them, and
     * this must not be read in three weeks as having addressed it.
     */
    expect(lib).toContain('Google does not participate');
  });
});
