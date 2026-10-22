import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The filter that keeps an automation from defaming someone.
 *
 * The operator wants a daily post built from this corpus. The obvious
 * way is to let Make read the database and fill a template — and that
 * is the version that eventually publishes "GOOGLE LLC — CNIL —
 * clôture" as though it were a fine, to a platform where a correction
 * does not travel with the original.
 *
 * It is not hypothetical. The extractor once returned "clôture de
 * l'injonction prononcée à l'encontre de SOLOCAL" as an `order`: the
 * CNIL said the company had COMPLIED and we were one step from
 * publishing it as a sanction, under its name, in seven languages.
 *
 * So the rule lives in our code, in one place, under test, and the
 * scenario consumes a list it cannot widen. These assertions are what
 * make "cannot widen" true.
 */

const ROUTE = readFileSync(
  join(__dirname, '..', 'src/app/api/public/decisions/route.ts'),
  'utf8'
);

describe('only an imposed measure against a named organisation is emitted', () => {
  it('admits exactly three outcomes', () => {
    expect(ROUTE).toContain("const PUBLISHABLE = new Set(['fine', 'reprimand', 'order'])");
  });

  it('never admits a closure', () => {
    /**
     * A closure is good news for the organisation — the regulator
     * recorded that it complied. Stripped to a name and a label in a
     * post, it reads as the opposite, and that is the one error here
     * worth being sued over.
     */
    expect(ROUTE).not.toMatch(/PUBLISHABLE[^;]*closed/);
    expect(ROUTE).toContain('`closed` is never here');
  });

  it('requires a named entity', () => {
    // A sanction is always against somebody. An Article 65 binding
    // decision between two supervisory authorities is not an order
    // against a company, and we published one as such once already.
    expect(ROUTE).toContain("Boolean(d.entity && d.entity.trim())");
  });

  it('reads only what a human approved', () => {
    // listPublishedDecisions filters on status = published, which is
    // the state a person sets in the review queue.
    expect(ROUTE).toContain('listPublishedDecisions(locale, 200)');
  });
});

describe('the filter cannot be widened from outside', () => {
  it('takes no outcome or status parameter', () => {
    /**
     * `locale` and `limit` are the only inputs. If a scenario could
     * pass `?outcome=closed`, the rule would live in the scenario —
     * which is exactly what this route exists to prevent.
     */
    const reads = [...ROUTE.matchAll(/params\.get\('([a-z]+)'\)/g)].map((m) => m[1]);
    expect(new Set(reads)).toEqual(new Set(['locale', 'limit']));
  });

  it('bounds the page size rather than trusting it', () => {
    expect(ROUTE).toContain('Math.min(Math.max(Math.trunc(requested), 1), MAX_ITEMS)');
  });

  it('falls back on an unknown locale instead of failing', () => {
    // A scenario that mistypes fr-FR should get English, not an outage
    // that silently stops the daily post.
    expect(ROUTE).toContain('NATIVE_LOCALE_CODES as readonly string[]).includes(asked)');
  });
});

describe('an unreadable corpus is never an empty one', () => {
  it('answers 503 rather than an empty list', () => {
    /**
     * A scenario that posts "nothing today" because the database
     * blinked is a scenario that lies quietly. 503 makes Make retry;
     * an empty array makes it believe.
     */
    expect(ROUTE).toContain("{ status: 503");
    expect(ROUTE).toContain('The corpus could not be read just now.');
  });
});

describe('every item can show its working', () => {
  it('carries the regulator page and our own', () => {
    expect(ROUTE).toContain('primaryUrl: d.primaryUrl');
    expect(ROUTE).toContain('url: `${base}/${locale}/decisions/${d.slug}`');
  });

  it('never emits an amount without its currency', () => {
    // A bare number is how a £963,900 penalty became "963 900 €" once,
    // under the name of a company that was never fined in euros.
    expect(ROUTE).toContain('fineAmount: d.fineCurrency ? d.fineAmount : null');
    expect(ROUTE).toContain('fineCurrency: d.fineAmount !== null ? d.fineCurrency : null');
  });

  it('states its own exclusions in the payload', () => {
    // So whoever wires the scenario reads the rule without opening
    // this repository.
    expect(ROUTE).toContain('excludes:');
    expect(ROUTE).toContain('natural persons');
  });
});
