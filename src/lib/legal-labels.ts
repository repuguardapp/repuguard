import type { FrameworkId, LegalFramework } from './legal-frameworks';

/**
 * The handful of words on a decision page that are ours rather than the
 * law's — and therefore the only ones that have to be translated.
 *
 * A decision page is almost entirely proper nouns: an authority, a
 * statute, article numbers, an amount, a date. Those stay put in every
 * language, which is why a model asked to translate a headline made of
 * them correctly hands it back untouched. The exceptions are the two
 * labels we choose ourselves — what kind of decision it was, and which
 * framework it falls under — and leaving those in English is what made
 * the Arabic and Japanese pages read as untranslated even though their
 * body text was fine.
 *
 * Translated in code rather than by a model because both are identity,
 * not prose: a title is a URL's public face and must render byte for
 * byte the same every time, and a framework badge must match the word
 * used on /compliance/[framework] or the internal link stops looking
 * like the same subject.
 *
 * Deliberately free of `server-only` and of any i18n runtime: the
 * localisation cron imports this outside a request scope, where
 * next-intl's `getTranslations` is not available.
 */

const OUTCOME: Record<string, Record<string, string>> = {
  fine:         { en: 'fine',         fr: 'amende',              es: 'multa',           de: 'Bußgeld',         'pt-br': 'multa',            ja: '制裁金',       ar: 'غرامة' },
  reprimand:    { en: 'reprimand',    fr: 'blâme',               es: 'apercibimiento',  de: 'Verwarnung',      'pt-br': 'advertência',      ja: '戒告',         ar: 'توبيخ' },
  ban:          { en: 'ban',          fr: 'interdiction',        es: 'prohibición',     de: 'Verbot',          'pt-br': 'proibição',        ja: '禁止',         ar: 'حظر' },
  order:        { en: 'order',        fr: 'injonction',          es: 'requerimiento',   de: 'Anordnung',       'pt-br': 'determinação',     ja: '命令',         ar: 'أمر' },
  guidance:     { en: 'guidance',     fr: 'lignes directrices',  es: 'directrices',     de: 'Leitlinien',      'pt-br': 'diretrizes',       ja: 'ガイドライン', ar: 'إرشادات' },
  court_ruling: { en: 'court ruling', fr: 'décision de justice', es: 'sentencia',       de: 'Gerichtsurteil',  'pt-br': 'decisão judicial', ja: '判決',         ar: 'حكم قضائي' },
  other:        { en: 'decision',     fr: 'décision',            es: 'resolución',      de: 'Entscheidung',    'pt-br': 'decisão',          ja: '決定',         ar: 'قرار' }
};

/**
 * What kind of decision this was, in one word, in one language.
 *
 * Falls back to the English column and then to the raw value with its
 * underscores removed, so a new outcome added upstream degrades to
 * something readable rather than to a blank badge.
 */
export function outcomeLabel(outcome: string, locale: string): string {
  const row = OUTCOME[outcome];
  if (!row) return outcome.replace(/_/g, ' ');
  return row[locale] ?? row['en'] ?? outcome.replace(/_/g, ' ');
}

/**
 * The badge form of a framework name.
 *
 * Short on purpose. `FRAMEWORKS[].name` is the full legal title —
 * "Personal Information Protection and Electronic Documents Act" — which
 * is right in an audit report and wrong in a badge sitting next to an
 * authority and a date. The acronym is also what a compliance officer
 * actually types into a search box.
 *
 * Most acronyms are the same in every language, so only the genuine
 * differences are listed: a French practitioner writes RGPD and LPRPDE,
 * a German DSGVO, and a Japanese one 個人情報保護法 rather than APPI.
 */
const SHORT: Record<FrameworkId, string> = {
  gdpr: 'GDPR',
  eu_ai_act: 'EU AI Act',
  lgpd: 'LGPD',
  appi: 'APPI',
  ccpa: 'CCPA / CPRA',
  pipeda: 'PIPEDA',
  uk_gdpr: 'UK GDPR',
  qatar_pdppl: 'Qatar PDPPL',
  saudi_pdpl: 'Saudi PDPL',
  uae_pdpl: 'UAE PDPL',
  bahrain_pdpl: 'Bahrain PDPL',
  kuwait_dppr: 'Kuwait DPPR',
  oman_pdpl: 'Oman PDPL'
};

const SHORT_BY_LOCALE: Partial<Record<FrameworkId, Record<string, string>>> = {
  gdpr: { fr: 'RGPD', es: 'RGPD', de: 'DSGVO', 'pt-br': 'RGPD' },
  uk_gdpr: {
    fr: 'RGPD britannique',
    es: 'RGPD del Reino Unido',
    de: 'UK-DSGVO',
    'pt-br': 'RGPD do Reino Unido',
    ja: '英国GDPR'
  },
  eu_ai_act: {
    fr: 'Règlement IA',
    es: 'Reglamento de IA',
    de: 'KI-Verordnung',
    'pt-br': 'Regulamento de IA',
    ja: 'EU AI法',
    ar: 'قانون الذكاء الاصطناعي'
  },
  appi: { ja: '個人情報保護法' },
  // The French acronym is genuinely different and is what the OPC
  // itself uses in its French-language material.
  pipeda: { fr: 'LPRPDE' }
};

export function frameworkLabel(framework: LegalFramework, locale: string): string {
  return SHORT_BY_LOCALE[framework.id]?.[locale] ?? SHORT[framework.id] ?? framework.name;
}
