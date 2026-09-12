/**
 * Localized copy for the three lifecycle emails.
 *
 * These were English-only while the product shipped in seven
 * languages and the org row already carried `ui_locale`. A prospect in
 * Riyadh who chose Arabic in the product, whose report came back in
 * Arabic, was then nurtured in English — by a company whose entire
 * pitch is that it works in their jurisdiction and their language.
 *
 * Kept apart from email-i18n.ts (which serves the transactional
 * "your audit is ready" message) because the two have different
 * shapes and different lifecycles: transactional copy changes when the
 * product changes, lifecycle copy changes when the offer changes.
 *
 * Same reasons as email-i18n.ts for living in code rather than in the
 * next-intl dictionaries: emails are server-only, there is no React
 * tree, and rendering one must pull in no dependencies.
 */

export type LifecycleLocale = 'en' | 'fr' | 'es' | 'de' | 'pt-br' | 'ja' | 'ar';

export interface UpgradeCopyInput {
  /** Human-readable framework list, already joined for this locale. */
  scope: string;
  score: number | null;
  findingsCount: number;
  /** Findings the paywall withheld. Zero when the reader saw them all. */
  hidden: number;
  reportUrl: string;
  pricingUrl: string;
  proCredits: number;
  starterCredits: number;
}

export interface LifecycleStrings {
  /** Drives dir= on the rendered HTML. Arabic is the only rtl locale we ship. */
  dir: 'ltr' | 'rtl';
  /** Joins a framework list the way the language does. */
  joinScope: (names: string[]) => string;

  welcomeSubject: string;
  welcomeHeading: string;
  welcomeCta: string;
  welcomeBody: (auditUrl: string, sampleUrl: string) => string;

  nudgeSubject: string;
  nudgeHeading: string;
  nudgeCta: string;
  nudgeBody: (auditUrl: string) => string;

  /** Used when the paywall actually withheld findings. */
  upgradeSubjectUnread: (hidden: number) => string;
  upgradeHeadingUnread: (hidden: number) => string;
  upgradeCtaUnread: string;
  /** Used when the reader has already seen the whole report. */
  upgradeSubjectSeen: string;
  upgradeHeadingSeen: string;
  upgradeCtaSeen: string;
  upgradeBody: (input: UpgradeCopyInput) => string;
}

/** "52/100", or nothing at all when we have no score. Never "null/100". */
function scoreClause(score: number | null, template: (s: number) => string): string {
  return score === null ? '' : template(score);
}

const MAP: Record<LifecycleLocale, LifecycleStrings> = {
  en: {
    dir: 'ltr',
    joinScope: (n) => (n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n.at(-1)}` : (n[0] ?? 'your frameworks')),
    welcomeSubject: 'Welcome to LexyFlow',
    welcomeHeading: 'Welcome to LexyFlow',
    welcomeCta: 'Audit your first document',
    welcomeBody: (audit, sample) => `Your account is ready. Upload any policy, contract or DPA and LexyFlow returns a compliance report with article-level citations in about a minute.

  ${audit}

Want to see a real report first? Here is a live audit against Qatar PDPPL:

  ${sample}`,
    nudgeSubject: 'Three documents our users audit first',
    nudgeHeading: 'Three documents to audit first',
    nudgeCta: 'Start my first audit',
    nudgeBody: (audit) => `Your account has been active a few days and we have not seen your first audit yet. Entirely normal — most people wonder where to start.

The three documents our users audit first:

  1. A vendor DPA from a SaaS you already use
  2. Your own public privacy policy
  3. A client contract that processes personal data

  ${audit}`,
    upgradeSubjectUnread: (h) => `${h} compliance gaps you haven't read yet`,
    upgradeHeadingUnread: (h) => `${h} findings still unread`,
    upgradeCtaUnread: 'Open my report',
    upgradeSubjectSeen: 'Your LexyFlow audit, two weeks on',
    upgradeHeadingSeen: 'Your audit, two weeks on',
    upgradeCtaSeen: 'See the plans',
    upgradeBody: (i) =>
      (i.hidden > 0
        ? `Two weeks ago you audited a document against ${i.scope}. We found ${i.findingsCount} compliance gaps${scoreClause(i.score, (s) => ` and scored it ${s}/100`)}.

You have read one of them. The other ${i.hidden} are still in your report, waiting.

  ${i.reportUrl}`
        : `Two weeks ago you audited a document against ${i.scope}${scoreClause(i.score, (s) => `, and it scored ${s}/100`)}. Thanks for putting us to work.

  ${i.reportUrl}`) +
      `

The Pro plan adds:

  - ${i.proCredits} audits per month
  - The full findings list on every report, with article-level citations
  - AI editor — rewrites a non-compliant clause while preserving your legal register
  - Cross-framework audits in a single run

  ${i.pricingUrl}

Starter is ${i.starterCredits} audits a month if that fits better.`
  },

  fr: {
    dir: 'ltr',
    joinScope: (n) => (n.length > 1 ? `${n.slice(0, -1).join(', ')} et ${n.at(-1)}` : (n[0] ?? 'vos référentiels')),
    welcomeSubject: 'Bienvenue sur LexyFlow',
    welcomeHeading: 'Bienvenue sur LexyFlow',
    welcomeCta: 'Auditer mon premier document',
    welcomeBody: (audit, sample) => `Votre compte est prêt. Déposez une politique, un contrat ou un DPA : LexyFlow renvoie un rapport de conformité avec citation des articles en une minute environ.

  ${audit}

Vous préférez voir un vrai rapport d'abord ? Voici un audit réel au regard du PDPPL qatari :

  ${sample}`,
    nudgeSubject: 'Les trois documents que nos utilisateurs auditent en premier',
    nudgeHeading: 'Trois documents pour commencer',
    nudgeCta: 'Lancer mon premier audit',
    nudgeBody: (audit) => `Votre compte est actif depuis quelques jours et nous n'avons pas encore vu votre premier audit. C'est tout à fait normal : la plupart des gens se demandent par où commencer.

Les trois documents que nos utilisateurs auditent en premier :

  1. Le DPA d'un prestataire SaaS que vous utilisez déjà
  2. Votre propre politique de confidentialité
  3. Un contrat client qui traite des données personnelles

  ${audit}`,
    upgradeSubjectUnread: (h) => `${h} lacunes de conformité que vous n'avez pas encore lues`,
    upgradeHeadingUnread: (h) => `${h} constatations non lues`,
    upgradeCtaUnread: 'Ouvrir mon rapport',
    upgradeSubjectSeen: 'Votre audit LexyFlow, deux semaines après',
    upgradeHeadingSeen: 'Votre audit, deux semaines après',
    upgradeCtaSeen: 'Voir les offres',
    upgradeBody: (i) =>
      (i.hidden > 0
        ? `Il y a deux semaines, vous avez audité un document au regard de ${i.scope}. Nous y avons trouvé ${i.findingsCount} lacunes de conformité${scoreClause(i.score, (s) => `, pour un score de ${s}/100`)}.

Vous en avez lu une. Les ${i.hidden} autres sont toujours dans votre rapport.

  ${i.reportUrl}`
        : `Il y a deux semaines, vous avez audité un document au regard de ${i.scope}${scoreClause(i.score, (s) => `, pour un score de ${s}/100`)}. Merci de nous avoir mis à l'épreuve.

  ${i.reportUrl}`) +
      `

L'offre Pro ajoute :

  - ${i.proCredits} audits par mois
  - La liste complète des constatations sur chaque rapport, articles cités
  - Éditeur IA — réécrit une clause non conforme en préservant votre registre juridique
  - Audits multi-référentiels en une seule passe

  ${i.pricingUrl}

L'offre Starter, c'est ${i.starterCredits} audits par mois si cela correspond mieux.`
  },

  es: {
    dir: 'ltr',
    joinScope: (n) => (n.length > 1 ? `${n.slice(0, -1).join(', ')} y ${n.at(-1)}` : (n[0] ?? 'tus marcos')),
    welcomeSubject: 'Bienvenido a LexyFlow',
    welcomeHeading: 'Bienvenido a LexyFlow',
    welcomeCta: 'Auditar mi primer documento',
    welcomeBody: (audit, sample) => `Tu cuenta está lista. Sube una política, un contrato o un DPA y LexyFlow devuelve un informe de cumplimiento con citas a nivel de artículo en aproximadamente un minuto.

  ${audit}

¿Prefieres ver antes un informe real? Aquí tienes una auditoría frente al PDPPL de Catar:

  ${sample}`,
    nudgeSubject: 'Los tres documentos que nuestros usuarios auditan primero',
    nudgeHeading: 'Tres documentos para empezar',
    nudgeCta: 'Iniciar mi primera auditoría',
    nudgeBody: (audit) => `Tu cuenta lleva activa unos días y aún no hemos visto tu primera auditoría. Es completamente normal: casi todo el mundo se pregunta por dónde empezar.

Los tres documentos que nuestros usuarios auditan primero:

  1. El DPA de un proveedor SaaS que ya utilizas
  2. Tu propia política de privacidad
  3. Un contrato de cliente que trata datos personales

  ${audit}`,
    upgradeSubjectUnread: (h) => `${h} brechas de cumplimiento que aún no has leído`,
    upgradeHeadingUnread: (h) => `${h} hallazgos sin leer`,
    upgradeCtaUnread: 'Abrir mi informe',
    upgradeSubjectSeen: 'Tu auditoría LexyFlow, dos semanas después',
    upgradeHeadingSeen: 'Tu auditoría, dos semanas después',
    upgradeCtaSeen: 'Ver los planes',
    upgradeBody: (i) =>
      (i.hidden > 0
        ? `Hace dos semanas auditaste un documento frente a ${i.scope}. Encontramos ${i.findingsCount} brechas de cumplimiento${scoreClause(i.score, (s) => ` y una puntuación de ${s}/100`)}.

Has leído una. Las otras ${i.hidden} siguen en tu informe.

  ${i.reportUrl}`
        : `Hace dos semanas auditaste un documento frente a ${i.scope}${scoreClause(i.score, (s) => `, con una puntuación de ${s}/100`)}. Gracias por ponernos a prueba.

  ${i.reportUrl}`) +
      `

El plan Pro añade:

  - ${i.proCredits} auditorías al mes
  - La lista completa de hallazgos en cada informe, con citas por artículo
  - Editor IA — reescribe una cláusula no conforme conservando tu registro jurídico
  - Auditorías multimarco en una sola ejecución

  ${i.pricingUrl}

El plan Starter son ${i.starterCredits} auditorías al mes si te encaja mejor.`
  },

  de: {
    dir: 'ltr',
    joinScope: (n) => (n.length > 1 ? `${n.slice(0, -1).join(', ')} und ${n.at(-1)}` : (n[0] ?? 'Ihre Regelwerke')),
    welcomeSubject: 'Willkommen bei LexyFlow',
    welcomeHeading: 'Willkommen bei LexyFlow',
    welcomeCta: 'Erstes Dokument prüfen',
    welcomeBody: (audit, sample) => `Ihr Konto ist bereit. Laden Sie eine Richtlinie, einen Vertrag oder einen AVV hoch — LexyFlow liefert in etwa einer Minute einen Compliance-Bericht mit Fundstellen auf Artikelebene.

  ${audit}

Lieber zuerst einen echten Bericht sehen? Hier eine Prüfung gegen das katarische PDPPL:

  ${sample}`,
    nudgeSubject: 'Drei Dokumente, die unsere Nutzer zuerst prüfen',
    nudgeHeading: 'Drei Dokumente für den Anfang',
    nudgeCta: 'Erste Prüfung starten',
    nudgeBody: (audit) => `Ihr Konto ist seit einigen Tagen aktiv, eine erste Prüfung haben wir noch nicht gesehen. Völlig normal — die meisten fragen sich, womit sie anfangen sollen.

Die drei Dokumente, die unsere Nutzer zuerst prüfen:

  1. Der AVV eines SaaS-Anbieters, den Sie bereits nutzen
  2. Ihre eigene Datenschutzerklärung
  3. Ein Kundenvertrag, der personenbezogene Daten verarbeitet

  ${audit}`,
    upgradeSubjectUnread: (h) => `${h} Compliance-Lücken, die Sie noch nicht gelesen haben`,
    upgradeHeadingUnread: (h) => `${h} ungelesene Befunde`,
    upgradeCtaUnread: 'Bericht öffnen',
    upgradeSubjectSeen: 'Ihr LexyFlow-Audit, zwei Wochen später',
    upgradeHeadingSeen: 'Ihr Audit, zwei Wochen später',
    upgradeCtaSeen: 'Tarife ansehen',
    upgradeBody: (i) =>
      (i.hidden > 0
        ? `Vor zwei Wochen haben Sie ein Dokument gegen ${i.scope} geprüft. Wir haben ${i.findingsCount} Compliance-Lücken gefunden${scoreClause(i.score, (s) => ` — Risiko-Score ${s}/100`)}.

Eine davon haben Sie gelesen. Die übrigen ${i.hidden} liegen weiterhin in Ihrem Bericht.

  ${i.reportUrl}`
        : `Vor zwei Wochen haben Sie ein Dokument gegen ${i.scope} geprüft${scoreClause(i.score, (s) => ` — Risiko-Score ${s}/100`)}. Danke, dass Sie uns auf die Probe gestellt haben.

  ${i.reportUrl}`) +
      `

Der Pro-Tarif ergänzt:

  - ${i.proCredits} Prüfungen pro Monat
  - Die vollständige Befundliste in jedem Bericht, mit Fundstellen auf Artikelebene
  - KI-Editor — schreibt eine nicht konforme Klausel um und wahrt Ihr juristisches Register
  - Prüfungen über mehrere Regelwerke in einem Durchlauf

  ${i.pricingUrl}

Starter umfasst ${i.starterCredits} Prüfungen pro Monat, falls das besser passt.`
  },

  'pt-br': {
    dir: 'ltr',
    joinScope: (n) => (n.length > 1 ? `${n.slice(0, -1).join(', ')} e ${n.at(-1)}` : (n[0] ?? 'seus marcos')),
    welcomeSubject: 'Bem-vindo ao LexyFlow',
    welcomeHeading: 'Bem-vindo ao LexyFlow',
    welcomeCta: 'Auditar meu primeiro documento',
    welcomeBody: (audit, sample) => `Sua conta está pronta. Envie uma política, um contrato ou um DPA e o LexyFlow devolve um relatório de conformidade com citações em nível de artigo em cerca de um minuto.

  ${audit}

Prefere ver um relatório real antes? Aqui está uma auditoria frente à PDPPL do Catar:

  ${sample}`,
    nudgeSubject: 'Os três documentos que nossos usuários auditam primeiro',
    nudgeHeading: 'Três documentos para começar',
    nudgeCta: 'Iniciar minha primeira auditoria',
    nudgeBody: (audit) => `Sua conta está ativa há alguns dias e ainda não vimos sua primeira auditoria. É totalmente normal — quase todo mundo se pergunta por onde começar.

Os três documentos que nossos usuários auditam primeiro:

  1. O DPA de um fornecedor SaaS que você já usa
  2. Sua própria política de privacidade
  3. Um contrato de cliente que trata dados pessoais

  ${audit}`,
    upgradeSubjectUnread: (h) => `${h} lacunas de conformidade que você ainda não leu`,
    upgradeHeadingUnread: (h) => `${h} achados não lidos`,
    upgradeCtaUnread: 'Abrir meu relatório',
    upgradeSubjectSeen: 'Sua auditoria LexyFlow, duas semanas depois',
    upgradeHeadingSeen: 'Sua auditoria, duas semanas depois',
    upgradeCtaSeen: 'Ver os planos',
    upgradeBody: (i) =>
      (i.hidden > 0
        ? `Há duas semanas você auditou um documento frente a ${i.scope}. Encontramos ${i.findingsCount} lacunas de conformidade${scoreClause(i.score, (s) => ` e pontuação ${s}/100`)}.

Você leu uma delas. As outras ${i.hidden} continuam no seu relatório.

  ${i.reportUrl}`
        : `Há duas semanas você auditou um documento frente a ${i.scope}${scoreClause(i.score, (s) => `, com pontuação ${s}/100`)}. Obrigado por nos colocar à prova.

  ${i.reportUrl}`) +
      `

O plano Pro acrescenta:

  - ${i.proCredits} auditorias por mês
  - A lista completa de achados em cada relatório, com citações por artigo
  - Editor de IA — reescreve uma cláusula não conforme preservando seu registro jurídico
  - Auditorias multimarco em uma única execução

  ${i.pricingUrl}

O plano Starter são ${i.starterCredits} auditorias por mês, se encaixar melhor.`
  },

  ja: {
    dir: 'ltr',
    joinScope: (n) => (n.length > 0 ? n.join('・') : '選択された規制'),
    welcomeSubject: 'LexyFlow へようこそ',
    welcomeHeading: 'LexyFlow へようこそ',
    welcomeCta: '最初の文書を監査する',
    welcomeBody: (audit, sample) => `アカウントの準備が整いました。ポリシー、契約書、DPA をアップロードすると、LexyFlow が約 1 分で条文レベルの根拠付き適合レポートをお返しします。

  ${audit}

先に実際のレポートをご覧になりますか。カタール PDPPL に対する実監査はこちらです。

  ${sample}`,
    nudgeSubject: '利用者が最初に監査する 3 つの文書',
    nudgeHeading: 'まずはこの 3 つから',
    nudgeCta: '最初の監査を始める',
    nudgeBody: (audit) => `アカウント作成から数日が経ちましたが、まだ最初の監査を拝見していません。どこから手をつけるか迷うのはごく自然なことです。

利用者が最初に監査する 3 つの文書：

  1. すでに利用中の SaaS ベンダーの DPA
  2. 自社のプライバシーポリシー
  3. 個人データを取り扱う顧客契約

  ${audit}`,
    upgradeSubjectUnread: (h) => `未読の指摘事項が ${h} 件あります`,
    upgradeHeadingUnread: (h) => `未読の指摘事項 ${h} 件`,
    upgradeCtaUnread: 'レポートを開く',
    upgradeSubjectSeen: '2 週間前の LexyFlow 監査について',
    upgradeHeadingSeen: '2 週間前の監査について',
    upgradeCtaSeen: '料金プランを見る',
    upgradeBody: (i) =>
      (i.hidden > 0
        ? `2 週間前、${i.scope} に対して文書を監査されました。適合上の不備が ${i.findingsCount} 件${scoreClause(i.score, (s) => `、リスクスコアは ${s}/100`)}でした。

うち 1 件はご覧いただいています。残る ${i.hidden} 件はレポートに残ったままです。

  ${i.reportUrl}`
        : `2 週間前、${i.scope} に対して文書を監査されました${scoreClause(i.score, (s) => `。リスクスコアは ${s}/100 です`)}。ご利用ありがとうございました。

  ${i.reportUrl}`) +
      `

Pro プランでは次が追加されます。

  - 月 ${i.proCredits} 件の監査
  - すべてのレポートで指摘事項の全件表示（条文レベルの根拠付き）
  - AI エディター — 法的文体を保ったまま不適合条項を書き換え
  - 複数規制を 1 回の実行で横断監査

  ${i.pricingUrl}

Starter プランは月 ${i.starterCredits} 件です。`
  },

  ar: {
    dir: 'rtl',
    joinScope: (n) => (n.length > 1 ? `${n.slice(0, -1).join('، ')} و${n.at(-1)}` : (n[0] ?? 'الأطر المختارة')),
    welcomeSubject: 'مرحبًا بك في LexyFlow',
    welcomeHeading: 'مرحبًا بك في LexyFlow',
    welcomeCta: 'ابدأ تدقيق أول مستند',
    welcomeBody: (audit, sample) => `حسابك جاهز. ارفع سياسة أو عقدًا أو اتفاقية معالجة بيانات، ويعيد LexyFlow تقرير امتثال يستشهد بالمواد تفصيليًا خلال دقيقة تقريبًا.

  ${audit}

تفضّل الاطلاع على تقرير حقيقي أولًا؟ هذا تدقيق فعلي وفق قانون حماية البيانات القطري:

  ${sample}`,
    nudgeSubject: 'ثلاثة مستندات يبدأ بها مستخدمونا',
    nudgeHeading: 'ثلاثة مستندات للبدء',
    nudgeCta: 'ابدأ أول تدقيق',
    nudgeBody: (audit) => `مضت بضعة أيام على تفعيل حسابك ولم نرَ أول تدقيق لك بعد. هذا أمر طبيعي تمامًا، فأغلب المستخدمين يتساءلون من أين يبدؤون.

المستندات الثلاثة التي يبدأ بها مستخدمونا:

  ١. اتفاقية معالجة البيانات لأحد مزوّدي الخدمات الذين تتعامل معهم
  ٢. سياسة الخصوصية الخاصة بمؤسستك
  ٣. عقد عميل ينطوي على معالجة بيانات شخصية

  ${audit}`,
    upgradeSubjectUnread: (h) => `${h} ثغرات امتثال لم تطّلع عليها بعد`,
    upgradeHeadingUnread: (h) => `${h} ملاحظات لم تُقرأ بعد`,
    upgradeCtaUnread: 'فتح التقرير',
    upgradeSubjectSeen: 'تدقيق LexyFlow بعد أسبوعين',
    upgradeHeadingSeen: 'تدقيقك بعد أسبوعين',
    upgradeCtaSeen: 'الاطلاع على الباقات',
    upgradeBody: (i) =>
      (i.hidden > 0
        ? `قبل أسبوعين دقّقت مستندًا وفق ${i.scope}. رصدنا ${i.findingsCount} ثغرات امتثال${scoreClause(i.score, (s) => ` بدرجة مخاطر ${s}/100`)}.

اطّلعت على واحدة منها، وما زالت ${i.hidden} ثغرات أخرى في تقريرك.

  ${i.reportUrl}`
        : `قبل أسبوعين دقّقت مستندًا وفق ${i.scope}${scoreClause(i.score, (s) => ` بدرجة مخاطر ${s}/100`)}. شكرًا لثقتك.

  ${i.reportUrl}`) +
      `

تضيف باقة Pro ما يلي:

  - ${i.proCredits} عملية تدقيق شهريًا
  - قائمة الملاحظات كاملةً في كل تقرير مع الاستشهاد بالمواد
  - محرّر ذكاء اصطناعي يعيد صياغة البند غير المتوافق مع الحفاظ على الصياغة القانونية
  - تدقيق عبر عدة أطر تنظيمية في تشغيل واحد

  ${i.pricingUrl}

وباقة Starter توفّر ${i.starterCredits} عمليات تدقيق شهريًا إن كانت أنسب.`
  }
};

export function lifecycleStringsFor(locale: string | null | undefined): LifecycleStrings {
  if (!locale) return MAP.en;
  const key = locale.toLowerCase() as LifecycleLocale;
  return MAP[key] ?? MAP.en;
}
