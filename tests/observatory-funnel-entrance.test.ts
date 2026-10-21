import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The only page that has ever earned organic traffic had no way in.
 *
 * `referrals` holds exactly one external row:
 *
 *   host www.google.com · path /observatory · hits 7
 *   first_seen 2026-09-28 16:08 · last_seen 2026-10-01 05:04
 *
 * Those are not crawler visits — a crawler sends no Referer header. They
 * are seven clicks on a Google result, by people, onto a page whose only
 * two links went to doi.org and to a CSV. The product was unreachable
 * from the one door the outside world had found, so nobody walked
 * through it, and the funnel's entry stage has read zero ever since.
 *
 * This file is the part that keeps the door there.
 */

const ROOT = join(__dirname, '..');
const PAGE = readFileSync(join(ROOT, 'src/app/[locale]/observatory/page.tsx'), 'utf8');

describe('the observatory offers a way into the product', () => {
  it('links to the scan form', () => {
    expect(PAGE).toContain('href="/scan"');
  });

  it('puts the entrance above the dataset download', () => {
    /**
     * Not cosmetic. The download card is conditional on
     * MIN_DOMAINS_FOR_DOWNLOAD, so on any day the dataset is small it
     * does not render at all. An entrance placed below it would be an
     * entrance that disappears exactly when the page is thinnest.
     */
    const entrance = PAGE.indexOf('href="/scan"');
    const download = PAGE.indexOf('href="/api/observatory/data.csv"');
    expect(entrance).toBeGreaterThan(0);
    expect(download).toBeGreaterThan(0);
    expect(entrance).toBeLessThan(download);
  });

  it('keeps the citation and the data above the offer', () => {
    /**
     * The page is worth traffic because it is neutral, and the DOI is
     * what certifies that. An offer placed above the findings would
     * trade the thing that earns the visit for the thing that converts
     * it — and this page's whole claim to a backlink is the first.
     */
    const doi = PAGE.indexOf('https://doi.org/');
    const entrance = PAGE.indexOf('href="/scan"');
    expect(doi).toBeGreaterThan(0);
    expect(doi).toBeLessThan(entrance);
  });
});

describe('the offer invents nothing', () => {
  const LOCALES = readdirSync(join(ROOT, 'messages'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));

  it('covers all seven public locales', () => {
    // If a locale is ever added, this number moves and the loop below
    // starts guarding it too.
    expect(LOCALES).toHaveLength(7);
    expect(LOCALES).toContain('ar');
  });

  it('reuses the scan form\'s own words in every one of them', () => {
    /**
     * The card says "what does your privacy policy publish?" and
     * describes the seven checks — which is what the scan form already
     * says, and what this dataset already measures. Reusing those keys
     * means no sentence was written to sell, and nothing had to be
     * translated into seven languages to put the door there.
     *
     * A missing key renders as the key itself. On the Arabic page that
     * would be a latin identifier in an RTL card, on the one page we
     * know strangers reach.
     */
    for (const locale of LOCALES) {
      const scan = JSON.parse(
        readFileSync(join(ROOT, 'messages', `${locale}.json`), 'utf8')
      ).scan;
      expect(scan?.formTitle, `${locale}.scan.formTitle`).toBeTruthy();
      expect(scan?.formLead, `${locale}.scan.formLead`).toBeTruthy();
    }
  });

  it('does not reach for an observatory key that would need writing', () => {
    // The card is built from tScan, not from t. If it ever switches to
    // the observatory namespace, seven translations become due and the
    // Arabic one is the one that gets forgotten.
    const card = PAGE.slice(PAGE.indexOf('The funnel entrance'), PAGE.indexOf('href="/scan"'));
    expect(card).toContain('tScan(');
  });
});
