import { describe, expect, it } from 'vitest';
import { FRAMEWORKS } from '@/lib/legal-frameworks';
import {
  authorityName,
  frameworkLabel,
  localizeInstrumentNames,
  outcomeLabel
} from '@/lib/legal-labels';

/**
 * The two words on a decision page that are ours rather than the law's.
 *
 * Everything else — authority, statute, article number, amount, date —
 * is a proper noun and stays put. These two do not, and both shipped in
 * English on all seven locales: the H1 read "€500,000 fine" in Arabic,
 * and the badge beside it read "General Data Protection Regulation".
 */

const LOCALES = ['en', 'fr', 'es', 'de', 'pt-br', 'ja', 'ar'] as const;

describe('the outcome word', () => {
  it('is translated in every locale we publish', () => {
    expect(outcomeLabel('fine', 'fr')).toBe('amende');
    expect(outcomeLabel('fine', 'ja')).toBe('制裁金');
    expect(outcomeLabel('fine', 'ar')).toBe('غرامة');
    expect(outcomeLabel('guidance', 'de')).toBe('Leitlinien');
  });

  it('leaves no locale without a word for any outcome we store', () => {
    // A missing cell would fall back to English, which is the exact
    // defect this table exists to close — and it would do so silently.
    for (const outcome of ['fine', 'reprimand', 'ban', 'order', 'guidance', 'court_ruling', 'other']) {
      for (const locale of LOCALES) {
        const label = outcomeLabel(outcome, locale);
        expect(label, `${outcome}/${locale}`).toBeTruthy();
        if (locale !== 'en') expect(label, `${outcome}/${locale}`).not.toBe(outcomeLabel(outcome, 'en'));
      }
    }
  });

  it('degrades to something readable for an outcome it has never seen', () => {
    // The extractor's enum can grow ahead of this table. A blank badge
    // would be worse than an untranslated one.
    expect(outcomeLabel('consent_withdrawal_order', 'fr')).toBe('consent withdrawal order');
  });

  it('falls back to English rather than to nothing for an unknown locale', () => {
    expect(outcomeLabel('fine', 'it')).toBe('fine');
  });
});

describe('the framework badge', () => {
  it('is an acronym, not the full legal title', () => {
    // "Personal Information Protection and Electronic Documents Act" is
    // right in an audit report and wrong in a badge sitting next to an
    // authority and a date — and it is not what anyone searches for.
    const pipeda = FRAMEWORKS.find((f) => f.id === 'pipeda')!;
    expect(frameworkLabel(pipeda, 'en')).toBe('PIPEDA');
    expect(frameworkLabel(pipeda, 'fr')).toBe('LPRPDE');
  });

  it('uses the acronym each language actually writes', () => {
    const gdpr = FRAMEWORKS.find((f) => f.id === 'gdpr')!;
    expect(frameworkLabel(gdpr, 'fr')).toBe('RGPD');
    expect(frameworkLabel(gdpr, 'de')).toBe('DSGVO');
    expect(frameworkLabel(gdpr, 'es')).toBe('RGPD');
    // Japanese and Arabic practitioners write the Latin acronym.
    expect(frameworkLabel(gdpr, 'ja')).toBe('GDPR');
    expect(frameworkLabel(gdpr, 'ar')).toBe('GDPR');
  });

  it('never renders the full name for any framework in any locale', () => {
    // The badge is the regression under test: a 60-character legal
    // title inside a Badge wraps to three lines and says nothing.
    for (const framework of FRAMEWORKS) {
      for (const locale of LOCALES) {
        const label = frameworkLabel(framework, locale);
        expect(label, `${framework.id}/${locale}`).not.toBe(framework.name);
        expect(label.length, `${framework.id}/${locale}`).toBeLessThanOrEqual(24);
      }
    }
  });

  it('covers every framework the engine can audit', () => {
    // A framework added to FRAMEWORKS without an entry here would fall
    // through to its full name and reintroduce the bug.
    for (const framework of FRAMEWORKS) {
      expect(frameworkLabel(framework, 'en'), framework.id).toBeTruthy();
    }
  });
});

describe('the regulator is named as it names itself', () => {
  it('uses the official name where the body has one', () => {
    // /compliance/gdpr read "Autorité de contrôle — European Data
    // Protection Board" on the French page. In French that is not the
    // body's name: EU institutions publish as the Comité européen de la
    // protection des données in every official language.
    expect(authorityName('European Data Protection Board', 'fr')).toBe(
      'Comité européen de la protection des données'
    );
    expect(authorityName('European Data Protection Board', 'de')).toBe(
      'Europäischer Datenschutzausschuss'
    );
    expect(authorityName('Office of the Privacy Commissioner of Canada', 'fr')).toBe(
      'Commissariat à la protection de la vie privée du Canada'
    );
    expect(authorityName('Personal Information Protection Commission', 'ja')).toBe(
      '個人情報保護委員会'
    );
  });

  it('leaves a body that has only one name alone', () => {
    // The ICO is the ICO in Paris, and SDAIA is SDAIA in Tokyo.
    // Inventing a translation would make us look like we were guessing
    // about the regulator whose decisions we summarise.
    for (const locale of ['fr', 'de', 'es', 'pt-br', 'ja', 'ar']) {
      expect(authorityName("Information Commissioner's Office", locale)).toBe(
        "Information Commissioner's Office"
      );
      expect(authorityName('Saudi Data & AI Authority (SDAIA)', locale)).toBe(
        'Saudi Data & AI Authority (SDAIA)'
      );
    }
  });

  it('never returns an empty string for any authority in any locale', () => {
    for (const framework of FRAMEWORKS) {
      for (const locale of LOCALES) {
        expect(authorityName(framework.authority, locale), `${framework.id}/${locale}`).toBeTruthy();
      }
    }
  });
});

describe('the instrument is named as the prose names it', () => {
  it('uses the local acronym in a sentence', () => {
    // A published French card showed the badge RGPD and, two lines
    // below, a summary saying GDPR. Both were right by their own rule
    // and wrong together.
    expect(localizeInstrumentNames("en vertu de l'Article 65(1)(a) GDPR", 'fr')).toBe(
      "en vertu de l'Article 65(1)(a) RGPD"
    );
    expect(localizeInstrumentNames('gemäß Artikel 32 GDPR', 'de')).toContain('DSGVO');
    expect(localizeInstrumentNames('el Artículo 6 GDPR', 'es')).toContain('RGPD');
  });

  it('leaves the languages that say GDPR alone', () => {
    // Japanese and Arabic practitioners write the Latin acronym, and
    // English is the pivot.
    for (const locale of ['en', 'ja', 'ar']) {
      expect(localizeInstrumentNames('GDPR Art. 32', locale), locale).toBe('GDPR Art. 32');
    }
  });

  it('never touches UK GDPR', () => {
    // A different instrument, with its own label and its own page.
    expect(localizeInstrumentNames('the UK GDPR and the GDPR', 'fr')).toBe(
      'the UK RGPD and the RGPD'.replace('UK RGPD', 'UK GDPR')
    );
  });

  it('cannot reach a digit or an article number', () => {
    const source = 'Une amende de 500 000 € au titre de GDPR Art. 65(1)(a) et GDPR Art. 9(2).';
    const out = localizeInstrumentNames(source, 'fr');
    expect(out.replace(/\D/g, '')).toBe(source.replace(/\D/g, ''));
    expect(out).toContain('RGPD Art. 65(1)(a)');
    expect(out).toContain('RGPD Art. 9(2)');
  });

  it('is idempotent and agrees with the badge', () => {
    const gdpr = FRAMEWORKS.find((f) => f.id === 'gdpr')!;
    for (const locale of LOCALES) {
      const once = localizeInstrumentNames('under GDPR', locale);
      expect(localizeInstrumentNames(once, locale), locale).toBe(once);
      // The substitution and the badge come from the same table, so
      // they cannot drift apart.
      expect(once).toContain(frameworkLabel(gdpr, locale));
    }
  });
});
