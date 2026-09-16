import { describe, expect, it } from 'vitest';
import { localizeDigitGroups } from '@/lib/number-format';

/**
 * A comma means different things in different languages.
 *
 * The first French decision page carried the fine twice and disagreed
 * with itself: "300 000 € amende" in the title, "une amende de 300,000
 * euros" in the body. In French, Spanish, German and Portuguese the
 * comma is the decimal mark, so the second one reads as three hundred
 * euros — on a page whose only job is to be exactly right about what a
 * regulator fined someone.
 */

const FR = 'La CNIL a infligé une amende de 300,000 euros à EXTIA.';

describe('grouped numbers follow the language around them', () => {
  it('rewrites the separator for languages where a comma is a decimal', () => {
    expect(localizeDigitGroups(FR, 'fr')).not.toContain('300,000');
    expect(localizeDigitGroups(FR, 'de')).toContain('300.000');
    expect(localizeDigitGroups(FR, 'es')).toContain('300.000');
    expect(localizeDigitGroups(FR, 'pt-br')).toContain('300.000');
  });

  it('leaves alone the languages that already group with a comma', () => {
    for (const locale of ['en', 'ja', 'ar']) {
      expect(localizeDigitGroups(FR, locale), locale).toBe(FR);
    }
  });

  it('agrees with the title, because both come from Intl', () => {
    // The two numbers on the page are formatted from the same source of
    // truth for what a thousand looks like, not from two conventions
    // that happen to coincide.
    const inTitle = new Intl.NumberFormat('fr-u-nu-latn', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0
    }).format(300000);
    const inBody = localizeDigitGroups('300,000 euros', 'fr');
    const digitsOnly = (s: string) => s.replace(/[^\d  .,\s]/g, '').trim();
    expect(digitsOnly(inBody).startsWith(digitsOnly(inTitle))).toBe(true);
  });
});

describe('digits are never touched', () => {
  it('carries the same digit sequence across every locale', () => {
    // The whole reason this is code and not a line in a model prompt:
    // a model invited to reformat a number can drop a digit.
    const source =
      'Fines of 1,234,567 euros and 89,000.50 euros, affecting 524,867 patients.';
    const digits = (s: string) => s.replace(/\D/g, '');
    for (const locale of ['fr', 'de', 'es', 'pt-br', 'ja', 'ar', 'en']) {
      expect(digits(localizeDigitGroups(source, locale)), locale).toBe(digits(source));
    }
  });

  it('moves the decimal mark with the grouping, not independently', () => {
    const out = localizeDigitGroups('89,000.50 euros', 'de');
    expect(out).toContain('89.000,50');
  });
});

describe('what it must not rewrite', () => {
  it('leaves an article list alone', () => {
    // "GDPR Art. 12, 17" carries a space and two digits, never three.
    const s = 'Articles cited: GDPR Art. 12, 17 and GDPR Art. 32, 34.';
    expect(localizeDigitGroups(s, 'fr')).toBe(s);
  });

  it('leaves dates and decision references alone', () => {
    const s = 'Délibération SAN-2026-009 du 2026-07-21.';
    expect(localizeDigitGroups(s, 'de')).toBe(s);
  });

  it('does not eat a digit out of "Law No. 13,2016"', () => {
    // Without a trailing word boundary the pattern matches "13,201"
    // and leaves a stray "6" in the prose — the exact silent
    // corruption this module exists to prevent.
    const s = 'Law No. 13,2016 of Qatar.';
    const out = localizeDigitGroups(s, 'fr');
    expect(out).toBe(s);
  });

  it('leaves a bare decimal alone', () => {
    // "3.2%" has no thousands group, so its meaning is unambiguous and
    // rewriting it would be guesswork.
    const s = 'Only 3.2% confirmed.';
    expect(localizeDigitGroups(s, 'fr')).toBe(s);
  });

  it('is idempotent', () => {
    const once = localizeDigitGroups(FR, 'fr');
    expect(localizeDigitGroups(once, 'fr')).toBe(once);
  });
});
