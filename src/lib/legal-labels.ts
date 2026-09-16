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

/**
 * The full name of a regulation, in the reader's language.
 *
 * This is the H1 of every /compliance/[framework] page — 13
 * frameworks × 7 locales = 91 pages that all read "General Data
 * Protection Regulation" until now, whatever language the rest of the
 * page was in.
 *
 * Where a regulation has an official name in the target language, that
 * name is used: the RGPD, the DSGVO, and the LPRPDE are not
 * translations, they are what those texts are actually called. Where it
 * has none — a Californian statute has no German title — the proper
 * noun is kept and a descriptive gloss in the reader's language is
 * added, which is what legal writing in that language does anyway.
 *
 * `FRAMEWORKS[].name` stays the English pivot and remains what the
 * audit engine cites, so nothing downstream of a report changes.
 */
const NAME_BY_LOCALE: Record<FrameworkId, Record<string, string>> = {
  gdpr: {
    en: 'General Data Protection Regulation',
    fr: 'Règlement général sur la protection des données (RGPD)',
    es: 'Reglamento General de Protección de Datos (RGPD)',
    de: 'Datenschutz-Grundverordnung (DSGVO)',
    'pt-br': 'Regulamento Geral sobre a Proteção de Dados (RGPD)',
    ja: 'EU一般データ保護規則（GDPR）',
    ar: 'اللائحة العامة لحماية البيانات (GDPR)'
  },
  eu_ai_act: {
    en: 'EU AI Act (Regulation 2024/1689)',
    fr: "Règlement européen sur l'intelligence artificielle (2024/1689)",
    es: 'Reglamento Europeo de Inteligencia Artificial (2024/1689)',
    de: 'KI-Verordnung der EU (2024/1689)',
    'pt-br': 'Regulamento Europeu de Inteligência Artificial (2024/1689)',
    ja: 'EU AI法（規則 2024/1689）',
    ar: 'قانون الذكاء الاصطناعي الأوروبي (2024/1689)'
  },
  lgpd: {
    en: 'Lei Geral de Proteção de Dados (Brazil)',
    fr: 'Lei Geral de Proteção de Dados (Brésil)',
    es: 'Lei Geral de Proteção de Dados (Brasil)',
    de: 'Lei Geral de Proteção de Dados (Brasilien)',
    'pt-br': 'Lei Geral de Proteção de Dados',
    ja: 'ブラジル一般データ保護法（LGPD）',
    ar: 'قانون حماية البيانات العام البرازيلي (LGPD)'
  },
  appi: {
    en: 'Act on the Protection of Personal Information (Japan)',
    fr: 'Loi japonaise sur la protection des informations personnelles (APPI)',
    es: 'Ley japonesa de protección de la información personal (APPI)',
    de: 'Japanisches Gesetz zum Schutz personenbezogener Informationen (APPI)',
    'pt-br': 'Lei japonesa de proteção de informações pessoais (APPI)',
    ja: '個人情報の保護に関する法律（個人情報保護法）',
    ar: 'قانون حماية المعلومات الشخصية الياباني (APPI)'
  },
  ccpa: {
    en: 'California Consumer Privacy Act / CPRA',
    fr: 'California Consumer Privacy Act / CPRA (Californie)',
    es: 'California Consumer Privacy Act / CPRA (California)',
    de: 'California Consumer Privacy Act / CPRA (Kalifornien)',
    'pt-br': 'California Consumer Privacy Act / CPRA (Califórnia)',
    ja: 'カリフォルニア州消費者プライバシー法（CCPA／CPRA）',
    ar: 'قانون خصوصية المستهلك في كاليفورنيا (CCPA/CPRA)'
  },
  pipeda: {
    en: 'Personal Information Protection and Electronic Documents Act',
    fr: 'Loi sur la protection des renseignements personnels et les documents électroniques (LPRPDE)',
    es: 'Ley canadiense de protección de la información personal y los documentos electrónicos (PIPEDA)',
    de: 'Kanadisches Gesetz zum Schutz personenbezogener Daten und über elektronische Dokumente (PIPEDA)',
    'pt-br': 'Lei canadense de proteção de informações pessoais e documentos eletrônicos (PIPEDA)',
    ja: 'カナダ個人情報保護・電子文書法（PIPEDA）',
    ar: 'قانون حماية المعلومات الشخصية والمستندات الإلكترونية الكندي (PIPEDA)'
  },
  uk_gdpr: {
    en: 'UK GDPR + Data Protection Act 2018',
    fr: 'RGPD britannique et Data Protection Act 2018',
    es: 'RGPD del Reino Unido y Data Protection Act 2018',
    de: 'UK-DSGVO und Data Protection Act 2018',
    'pt-br': 'RGPD do Reino Unido e Data Protection Act 2018',
    ja: '英国GDPRおよび2018年データ保護法',
    ar: 'اللائحة البريطانية لحماية البيانات وقانون حماية البيانات 2018'
  },
  qatar_pdppl: {
    en: 'Qatar PDPPL — Personal Data Privacy Protection Law (Law No. 13 of 2016)',
    fr: 'PDPPL qatarie — loi sur la protection de la vie privée et des données personnelles (loi n° 13 de 2016)',
    es: 'PDPPL de Catar — Ley de protección de la privacidad de los datos personales (Ley n.º 13 de 2016)',
    de: 'Katarisches PDPPL — Gesetz zum Schutz personenbezogener Daten (Gesetz Nr. 13 von 2016)',
    'pt-br': 'PDPPL do Catar — Lei de proteção da privacidade de dados pessoais (Lei n.º 13 de 2016)',
    ja: 'カタール個人データプライバシー保護法（2016年法律第13号）',
    ar: 'قانون حماية خصوصية البيانات الشخصية القطري (قانون رقم 13 لسنة 2016)'
  },
  saudi_pdpl: {
    en: 'Saudi PDPL — Personal Data Protection Law (Royal Decree M/19, as amended 2023)',
    fr: 'PDPL saoudienne — loi sur la protection des données personnelles (décret royal M/19, modifié en 2023)',
    es: 'PDPL de Arabia Saudí — Ley de protección de datos personales (Decreto Real M/19, modificado en 2023)',
    de: 'Saudisches PDPL — Gesetz zum Schutz personenbezogener Daten (Königliches Dekret M/19, geändert 2023)',
    'pt-br': 'PDPL da Arábia Saudita — Lei de proteção de dados pessoais (Decreto Real M/19, alterado em 2023)',
    ja: 'サウジアラビア個人データ保護法（勅令M/19、2023年改正）',
    ar: 'نظام حماية البيانات الشخصية السعودي (المرسوم الملكي م/19، المعدّل 2023)'
  },
  uae_pdpl: {
    en: 'UAE PDPL — Federal Decree-Law No. 45 of 2021 on Personal Data Protection',
    fr: 'PDPL émiratie — décret-loi fédéral n° 45 de 2021 sur la protection des données personnelles',
    es: 'PDPL de los EAU — Decreto-Ley Federal n.º 45 de 2021 sobre protección de datos personales',
    de: 'VAE-PDPL — Föderales Dekretgesetz Nr. 45 von 2021 zum Schutz personenbezogener Daten',
    'pt-br': 'PDPL dos EAU — Decreto-Lei Federal n.º 45 de 2021 sobre proteção de dados pessoais',
    ja: 'UAE個人データ保護法（2021年連邦法令第45号）',
    ar: 'قانون حماية البيانات الشخصية الإماراتي (مرسوم بقانون اتحادي رقم 45 لسنة 2021)'
  },
  bahrain_pdpl: {
    en: 'Bahrain PDPL — Personal Data Protection Law (Law No. 30 of 2018)',
    fr: 'PDPL bahreïnie — loi sur la protection des données personnelles (loi n° 30 de 2018)',
    es: 'PDPL de Baréin — Ley de protección de datos personales (Ley n.º 30 de 2018)',
    de: 'Bahrainisches PDPL — Gesetz zum Schutz personenbezogener Daten (Gesetz Nr. 30 von 2018)',
    'pt-br': 'PDPL do Bahrein — Lei de proteção de dados pessoais (Lei n.º 30 de 2018)',
    ja: 'バーレーン個人データ保護法（2018年法律第30号）',
    ar: 'قانون حماية البيانات الشخصية البحريني (قانون رقم 30 لسنة 2018)'
  },
  kuwait_dppr: {
    en: 'Kuwait DPPR — Data Privacy Protection Regulation (CITRA Resolution No. 26 of 2024)',
    fr: 'DPPR koweïtienne — règlement sur la protection de la confidentialité des données (résolution CITRA n° 26 de 2024)',
    es: 'DPPR de Kuwait — Reglamento de protección de la privacidad de los datos (Resolución CITRA n.º 26 de 2024)',
    de: 'Kuwaitisches DPPR — Verordnung zum Schutz der Datenprivatsphäre (CITRA-Beschluss Nr. 26 von 2024)',
    'pt-br': 'DPPR do Kuwait — Regulamento de proteção da privacidade de dados (Resolução CITRA n.º 26 de 2024)',
    ja: 'クウェート データプライバシー保護規則（CITRA決議2024年第26号）',
    ar: 'لائحة حماية خصوصية البيانات الكويتية (قرار هيئة الاتصالات رقم 26 لسنة 2024)'
  },
  oman_pdpl: {
    en: 'Oman PDPL — Personal Data Protection Law (Royal Decree No. 6 of 2022)',
    fr: 'PDPL omanaise — loi sur la protection des données personnelles (décret royal n° 6 de 2022)',
    es: 'PDPL de Omán — Ley de protección de datos personales (Decreto Real n.º 6 de 2022)',
    de: 'Omanisches PDPL — Gesetz zum Schutz personenbezogener Daten (Königliches Dekret Nr. 6 von 2022)',
    'pt-br': 'PDPL de Omã — Lei de proteção de dados pessoais (Decreto Real n.º 6 de 2022)',
    ja: 'オマーン個人データ保護法（2022年勅令第6号）',
    ar: 'قانون حماية البيانات الشخصية العُماني (مرسوم سلطاني رقم 6 لسنة 2022)'
  }
};

export function frameworkName(framework: LegalFramework, locale: string): string {
  const row = NAME_BY_LOCALE[framework.id];
  return row?.[locale] ?? row?.['en'] ?? framework.name;
}

/**
 * How finely each text is cited — one table cell on a comparison page.
 *
 * Kept out of running prose deliberately. "Article-level citations"
 * inlines a noun into an English construction; French, Spanish and
 * German would each need the article and the agreement to match the
 * word substituted in, and the sentence would be wrong more often than
 * right. As a standalone cell it is just a noun, and the surrounding
 * copy says "down to the exact provision" instead.
 */
const CITATION: Record<string, Record<string, string>> = {
  article: { en: 'Article',  fr: 'Article', es: 'Artículo', de: 'Artikel',  'pt-br': 'Artigo',   ja: '条',   ar: 'مادة' },
  section: { en: 'Section',  fr: 'Section', es: 'Sección',  de: 'Abschnitt', 'pt-br': 'Seção',   ja: '節',   ar: 'قسم' },
  chapter: { en: 'Chapter',  fr: 'Chapitre', es: 'Capítulo', de: 'Kapitel', 'pt-br': 'Capítulo', ja: '章',   ar: 'فصل' }
};

export function citationLabel(style: string, locale: string): string {
  const row = CITATION[style];
  if (!row) return style;
  return row[locale] ?? row['en'] ?? style;
}

/**
 * The name a supervisory authority goes by in the reader's language.
 *
 * Sparse on purpose. Most of these are proper nouns with one name —
 * the ICO is the ICO in Paris, SDAIA is SDAIA in Tokyo — and inventing
 * a translation for a body that has none would make us look like we
 * were guessing about the regulator whose decisions we summarise.
 *
 * But four of them genuinely have official names in other languages,
 * and the most visible one sits on our most important page: the
 * /compliance/gdpr card read "Autorité de contrôle — European Data
 * Protection Board", which in French is not the body's name. It is the
 * Comité européen de la protection des données, and EU institutions
 * publish under that name in every official language.
 *
 * Anything absent falls back to `FRAMEWORKS[].authority`, which is what
 * the audit engine cites and stays untouched.
 */
const AUTHORITY_BY_LOCALE: Record<string, Record<string, string>> = {
  'European Data Protection Board': {
    fr: 'Comité européen de la protection des données',
    es: 'Comité Europeo de Protección de Datos',
    de: 'Europäischer Datenschutzausschuss',
    'pt-br': 'Comité Europeu para a Proteção de Dados',
    ja: '欧州データ保護会議',
    ar: 'المجلس الأوروبي لحماية البيانات'
  },
  'European AI Office': {
    fr: "Bureau européen de l'intelligence artificielle",
    es: 'Oficina Europea de Inteligencia Artificial',
    de: 'Europäisches Büro für Künstliche Intelligenz',
    'pt-br': 'Gabinete Europeu para a Inteligência Artificial',
    ja: '欧州AI事務局',
    ar: 'المكتب الأوروبي للذكاء الاصطناعي'
  },
  // Canada legislates in both languages; this is the body's own French
  // name, not a rendering of the English one.
  'Office of the Privacy Commissioner of Canada': {
    fr: 'Commissariat à la protection de la vie privée du Canada'
  },
  // Likewise the Japanese commission's own name.
  'Personal Information Protection Commission': {
    ja: '個人情報保護委員会'
  },
  ANPD: {
    'pt-br': 'Autoridade Nacional de Proteção de Dados (ANPD)'
  }
};

export function authorityName(authority: string, locale: string): string {
  return AUTHORITY_BY_LOCALE[authority]?.[locale] ?? authority;
}

/**
 * Name the instrument as the language around it names it.
 *
 * A published French card carried the badge RGPD and, two lines below,
 * a summary saying GDPR. Both were right by their own rule and wrong
 * together: the badge comes from this file's acronym table, the
 * summary from a model told never to translate statute names — an
 * instruction that exists so "GDPR Art. 32" survives intact and stays
 * searchable.
 *
 * The editorial answer is the one French legal writing already uses:
 * RGPD in prose, GDPR in an article reference. So the structured
 * fields — the `articles` column, the badges, the assembled titles —
 * keep the canonical English form the audit engine cites, and the
 * prose takes the reader's acronym.
 *
 * Done as a substitution rather than an instruction for the same
 * reason the digit grouping is: a model invited to rewrite a citation
 * is a model that can renumber an article. This touches one token and
 * cannot reach a number.
 *
 * Drawn from the same table as the badges, so the two cannot drift.
 * "UK GDPR" is left alone — it is a different instrument with its own
 * label and its own page.
 */
export function localizeInstrumentNames(text: string, locale: string): string {
  const local = SHORT_BY_LOCALE['gdpr']?.[locale];
  if (!local || local === 'GDPR') return text;
  return text.replace(/(?<!UK )\bGDPR\b/g, local);
}
