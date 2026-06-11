/**
 * Sample audit fixtures backing the public /sample-report page.
 *
 * Strategic note — the sample report is the asymmetric anchor for
 * GCC market positioning. Every fixture here is a Qatar PDPPL
 * (Law No. 13 of 2016) walkthrough on the privacy policy of a
 * plausible Qatari controller. The Arabic version is the canonical
 * native edition; English provides parity for visitors who can't
 * read Arabic but should still see that LexyFlow handles the GCC
 * regulatory surface natively rather than via translation of GDPR
 * findings.
 *
 * The fixture stays a hand-crafted constant rather than an LLM
 * generation: the marketing-grade text needs to be byte-stable
 * across deploys (it's a brand surface) and legally accurate to
 * the specific articles cited (Article 17 on marketing consent,
 * Article 13 on minors, Article 6 on retention).
 */

export interface SampleFinding {
  severity: 'critical' | 'high' | 'medium';
  framework: string;
  title: string;
  body: string;
  recommendation: string;
}

export interface SampleFixture {
  orgName: string;
  riskScore: number;
  seconds: number;
  frameworkCount: number;
  findings: SampleFinding[];
}

const QATAR_FIXTURE_AR: SampleFixture = {
  orgName: 'هيئة قطر الوطنية للسياحة (QNTC)',
  riskScore: 75,
  seconds: 47,
  frameworkCount: 1,
  findings: [
    {
      severity: 'critical',
      framework: 'Qatar PDPPL Art. 17',
      title: 'آلية الاشتراك في التسويق غير موصوفة؛ إجراء الانسحاب غائب',
      body: 'تتطلب المادة 17 من قانون حماية خصوصية البيانات الشخصية موافقة صريحة ومسبقة (opt-in) لأي اتصال تسويقي مباشر، مع جعل الانسحاب سهلاً ومجانياً. يكتفي الإشعار بالإشارة إلى وجود "سياسة اشتراك" دون وصف الآلية الفعلية، ولا يُتيح قناة انسحاب موثّقة (رابط، بريد، نموذج).',
      recommendation: 'وصف آلية الاشتراك بشكل صريح (مربع اختيار غير مُحدَّد مسبقاً)، وإضافة قناة انسحاب فورية مجانية (مثل privacy@visitqatar.com)، مع ضمان أن يكون الانسحاب سهلاً مثل الاشتراك. الفشل في المعالجة يعرّض الجهة لغرامات تصل إلى 5,000,000 ﷼ قطري بموجب المواد 22-25.'
    },
    {
      severity: 'high',
      framework: 'Qatar PDPPL Art. 13',
      title: 'بيانات القاصرين دون موافقة وَلي قابلة للتحقق',
      body: 'يجمع النموذج تاريخ الميلاد للضيوف دون مرشّح عمري وبدون أي تدفّق للحصول على موافقة الوالد/الوصي للأطفال دون 18 سنة، خلافاً لمتطلّبات المادة 13 الخاصة بحماية بيانات القاصرين.',
      recommendation: 'إضافة بوابة عمرية في النموذج، وإطلاق تدفّق موافقة الوالد عبر بريد إلكتروني موثَّق عند اكتشاف قاصر. تطبيق مبدأ تقليل البيانات: عدم جمع تفضيلات سلوكية أو إعلانات موجَّهة على بيانات القاصرين.'
    },
    {
      severity: 'medium',
      framework: 'Qatar PDPPL Art. 6',
      title: 'فترة الاحتفاظ غير محدّدة لسجلات الحجوزات',
      body: 'يلتزم الإشعار بحفظ بيانات الحجز "للمدة اللازمة" دون تحديد مدة أو معيار موضوعي. المادة 6 تتطلّب الحدّ من الاحتفاظ بالبيانات إلى ما هو ضروري للغرض المعلَن.',
      recommendation: 'استبدال الصياغة بمدة ملموسة (مثل 36 شهراً بعد آخر تفاعل) أو معيار واضح (حتى إلغاء الحساب). توثيق نفس المدة في سجلّ المعالجة الداخلي.'
    }
  ]
};

const QATAR_FIXTURE_EN: SampleFixture = {
  orgName: 'Qatar National Tourism Council (QNTC)',
  riskScore: 75,
  seconds: 47,
  frameworkCount: 1,
  findings: [
    {
      severity: 'critical',
      framework: 'Qatar PDPPL Art. 17',
      title: 'Marketing opt-in mechanism not described; opt-out channel absent',
      body: 'Article 17 of the PDPPL (Law No. 13 of 2016) requires explicit, prior consent for any direct marketing communication, and mandates that opting out be as easy and free as opting in. The notice merely references an "opt-in policy" without describing the actual mechanism, and provides no documented opt-out channel (link, email, or form). This is the single most common PDPPL enforcement trigger flagged by the NCSA Compliance and Data Protection Department.',
      recommendation: 'Describe the opt-in flow explicitly (an unticked checkbox at the point of data collection, not a banner buried in the privacy notice). Add a one-click, fee-free opt-out channel — for example a mailto:privacy@visitqatar.com or an unsubscribe link in every marketing email. Ensure opt-out is at least as easy as opt-in. Failure to remediate exposes the controller to fines up to QAR 5,000,000 under PDPPL Articles 22-25.'
    },
    {
      severity: 'high',
      framework: 'Qatar PDPPL Art. 13',
      title: 'Minors\' data collected without verifiable parental consent',
      body: 'The guest registration form collects date of birth without an age gate and without any flow to obtain verifiable parental or guardian consent for users under 18. Article 13 of the PDPPL requires specific protections for minors\' personal data, including parental consent for processing and a heightened data-minimisation standard.',
      recommendation: 'Add an age gate to the form. When a minor is detected, trigger a verifiable parental-consent flow (signed email with verification token, returning the parent to a confirmation URL). Apply data minimisation: do not collect behavioural preferences or run targeted advertising on minors\' records.'
    },
    {
      severity: 'medium',
      framework: 'Qatar PDPPL Art. 6',
      title: 'Retention period undefined for booking records',
      body: 'The notice commits to retaining booking data "for the period necessary" without specifying a duration or an objective criterion. Article 6 of the PDPPL requires retention to be limited to what is strictly necessary for the declared purpose, and the controller must be able to evidence the duration chosen.',
      recommendation: 'Replace the wording with a concrete duration (e.g. "36 months after the last interaction") or a clear criterion (e.g. "until account deletion, whichever is sooner"). Document the same retention rule in the internal Article 30-equivalent processing register so the published notice and the internal record are consistent.'
    }
  ]
};

/**
 * Locale resolver. Returns the native Arabic fixture for /ar and the
 * English translation for every other locale. The locale switcher
 * in the page UI lets visitors flip between language editions
 * without changing the underlying audit (Qatar PDPPL throughout) —
 * Arabic readers see the native edition, everyone else sees the
 * English edition with the same articles, the same risk score,
 * and the same recommendations.
 */
export function getSampleFixture(locale: string): SampleFixture {
  if (locale === 'ar') return QATAR_FIXTURE_AR;
  return QATAR_FIXTURE_EN;
}
