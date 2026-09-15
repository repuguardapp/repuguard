import { NextResponse } from 'next/server';
import { z } from 'zod';
import { alertOps } from '@/lib/alert';
import { isCronAuthorized } from '@/lib/cron-auth';
import { OPENAI_MODEL, openai } from '@/lib/ai-clients';
import { supabaseService } from '@/lib/supabase';

/**
 * Legal watch, pass 3 — publish an approved item in seven languages.
 *
 * Runs only on rows a person has approved, so by the time anything
 * reaches this file the facts have been checked against the primary
 * source. What remains is translation, and one editorial decision
 * embedded in the code: the headline is BUILT, not borrowed.
 *
 * A regulator's own headline is their prose and their copyright. Ours
 * is assembled from the facts — authority, outcome, amount, date —
 * which are not copyrightable and which happen to make a better title
 * anyway: every page in the corpus reads the same way, and the words a
 * compliance officer would search for are in it.
 *
 * ALL OR NOTHING
 *
 * An item publishes in seven languages or in none. A page that exists
 * in four while hreflang advertises seven is broken SEO — Google
 * expects reciprocal links across the set — and a "translated" page
 * that is silently English is duplicate content that competes with our
 * own /en page. A partial failure leaves the row `approved`, and the
 * next run retries the whole item.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The six targets. English is the pivot and is never sent to a model. */
const TARGET_LOCALES = ['fr', 'es', 'de', 'pt-br', 'ja', 'ar'] as const;

/**
 * Items per run. Each costs six short translation calls, so this is the
 * spend ceiling. Steady state is a couple of approved decisions a day,
 * well under it; the cap exists for the day a backlog is approved in
 * one sitting.
 */
const MAX_ITEMS_PER_RUN = 4;

const Translated = z.object({ summary: z.string().min(1) });

interface ApprovedRow {
  id: string;
  slug: string | null;
  authority: string | null;
  decision_date: string | null;
  articles: string[] | null;
  fine_eur: number | null;
  outcome: string | null;
  summary_en: string | null;
}

export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return localize();
}

export async function POST(request: Request) {
  if (!(await isCronAuthorized(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return localize();
}

async function localize() {
  const db = supabaseService();

  const { data, error } = await db
    .from('legal_developments')
    .select('id, slug, authority, decision_date, articles, fine_eur, outcome, summary_en')
    .eq('status', 'approved')
    .order('reviewed_at', { ascending: true, nullsFirst: false })
    .limit(MAX_ITEMS_PER_RUN);

  if (error) {
    console.error('[cron/localize-legal] queue_unreadable', { error: error.message });
    alertOps('cron.localize_legal_queue_unreadable', { error: error.message });
    return NextResponse.json({ error: 'queue_unreadable', detail: error.message }, { status: 500 });
  }

  const queue = (data ?? []) as ApprovedRow[];
  // Nothing approved is the normal state — this runs on a schedule and
  // approvals arrive when a human opens the queue, not on a timetable.
  if (queue.length === 0) {
    return NextResponse.json({ ok: true, published: 0, failed: 0, note: 'queue empty' });
  }

  const stats = { published: 0, failed: 0 };

  for (const item of queue) {
    try {
      await publishOne(db, item);
      stats.published += 1;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[cron/localize-legal] item_failed', { id: item.id, error: detail });
      alertOps('cron.localize_legal_item_failed', { developmentId: item.id, error: detail });
      stats.failed += 1;
    }
  }

  console.log('[cron/localize-legal] run complete', stats);
  return NextResponse.json({ ok: true, ...stats });
}

async function publishOne(db: ReturnType<typeof supabaseService>, item: ApprovedRow): Promise<void> {
  if (!item.summary_en || !item.slug) {
    // Approval should be impossible without both. Refusing here rather
    // than publishing a headline with no body keeps the failure where
    // it can be seen.
    throw new Error('approved item is missing its summary or slug');
  }

  // The six run concurrently: same token count, a fraction of the wall
  // clock, and each one's failure is independent until we collect them.
  // Only the summary is sent — the title is assembled per locale below.
  const results = await Promise.allSettled(
    TARGET_LOCALES.map((locale) => translate(item.summary_en!, locale))
  );

  const failures = results
    .map((r, i) => (r.status === 'rejected' ? `${TARGET_LOCALES[i]}: ${String(r.reason)}` : null))
    .filter((s): s is string => s !== null);

  if (failures.length > 0) {
    // All or nothing — the row stays `approved` and the whole item is
    // retried. Publishing the successful five would advertise seven
    // languages in hreflang and serve English under two of them.
    throw new Error(`translation failed for ${failures.length} locale(s): ${failures.join('; ')}`);
  }

  const rows = [
    // English is the pivot: a person approved these exact words, so
    // they are stored verbatim rather than round-tripped through a
    // model that could only degrade them.
    { development_id: item.id, locale: 'en', title: buildTitle(item, 'en'), summary: item.summary_en },
    ...TARGET_LOCALES.map((locale, i) => ({
      development_id: item.id,
      locale,
      title: buildTitle(item, locale),
      summary: (results[i] as PromiseFulfilledResult<z.infer<typeof Translated>>).value.summary
    }))
  ];

  const { error: writeErr } = await db
    .from('legal_development_locales')
    .upsert(rows, { onConflict: 'development_id,locale' });
  if (writeErr) throw new Error(`locale write failed: ${writeErr.message}`);

  // Status last. Until this line the item is invisible to the public
  // site, so a crash between the two writes leaves translations that
  // the next run simply overwrites — never a published page with no
  // text.
  const { error: statusErr } = await db
    .from('legal_developments')
    .update({ status: 'published', updated_at: new Date().toISOString() })
    .eq('id', item.id)
    .eq('status', 'approved');
  if (statusErr) throw new Error(`status write failed: ${statusErr.message}`);
}

/**
 * The one word in the headline that is ours rather than the law's.
 *
 * Everything else in a title — the authority, the amount, the article
 * numbers, the date — is a proper noun or a figure and stays put in
 * every language. The outcome is the exception, and leaving it in
 * English is what made the Arabic and Japanese pages read as
 * untranslated: the H1 was "CNIL — €500,000 fine — GDPR Art. 32 —
 * 2026-07-21" on all seven.
 *
 * Translated here rather than by the model, because a title is a URL's
 * public face and an identity: it must be identical every time it is
 * rendered, and a model asked to translate a string that is nine parts
 * proper noun will sometimes return it untouched and sometimes
 * transliterate the lot.
 */
const OUTCOME_LABEL: Record<string, Record<string, string>> = {
  fine:         { en: 'fine',        fr: 'amende',        es: 'multa',           de: 'Bußgeld',        'pt-br': 'multa',        ja: '制裁金',   ar: 'غرامة' },
  reprimand:    { en: 'reprimand',   fr: 'blâme',         es: 'apercibimiento',  de: 'Verwarnung',     'pt-br': 'advertência',  ja: '戒告',     ar: 'توبيخ' },
  ban:          { en: 'ban',         fr: 'interdiction',  es: 'prohibición',     de: 'Verbot',         'pt-br': 'proibição',    ja: '禁止',     ar: 'حظر' },
  order:        { en: 'order',       fr: 'injonction',    es: 'requerimiento',   de: 'Anordnung',      'pt-br': 'determinação', ja: '命令',     ar: 'أمر' },
  guidance:     { en: 'guidance',    fr: 'lignes directrices', es: 'directrices', de: 'Leitlinien',    'pt-br': 'diretrizes',   ja: 'ガイドライン', ar: 'إرشادات' },
  court_ruling: { en: 'court ruling', fr: 'décision de justice', es: 'sentencia', de: 'Gerichtsurteil', 'pt-br': 'decisão judicial', ja: '判決', ar: 'حكم قضائي' },
  other:        { en: 'decision',    fr: 'décision',      es: 'resolución',      de: 'Entscheidung',   'pt-br': 'decisão',      ja: '決定',     ar: 'قرار' }
};

/**
 * Our own headline, assembled from the facts, in one language.
 *
 * Never the regulator's — their headline is their prose. These are
 * facts, which carry no copyright, and the result is more useful than
 * a borrowed title: consistent across the whole corpus, and carrying
 * the terms a compliance officer actually searches for.
 */
function buildTitle(item: ApprovedRow, locale: string): string {
  const parts: string[] = [];
  parts.push(item.authority ?? 'Regulator');

  if (item.fine_eur !== null && item.fine_eur > 0) {
    // `-u-nu-latn` forces Latin digits: Arabic would otherwise render
    // ٥٠٠٬٠٠٠, which nobody searching for this fine will ever type.
    const amount = new Intl.NumberFormat(`${locale}-u-nu-latn`, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0
    }).format(item.fine_eur);
    parts.push(`${amount} ${OUTCOME_LABEL['fine']?.[locale] ?? 'fine'}`);
  } else if (item.outcome) {
    parts.push(OUTCOME_LABEL[item.outcome]?.[locale] ?? item.outcome.replace(/_/g, ' '));
  }

  if (item.articles && item.articles.length > 0) {
    // Two is enough to be specific without becoming a list; a title
    // carrying nine article numbers helps nobody.
    parts.push(item.articles.slice(0, 2).join(', '));
  }

  if (item.decision_date) parts.push(item.decision_date);

  return parts.join(' — ');
}

async function translate(
  summaryEn: string,
  targetLanguage: string
): Promise<z.infer<typeof Translated>> {
  const completion = await openai().chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          `You translate regulatory summaries into ${targetLanguage} (BCP-47).`,
          'Preserve a formal, factual register. Translate only the prose.',
          'Do NOT translate: authority names and acronyms, statute names,',
          'article numbers, dates, or currency amounts — pass those through',
          'exactly as written.',
          'For Arabic output use Modern Standard Arabic, keep numerals in',
          'Latin digits, and emit no bidi control characters.',
          'Return JSON with exactly the key "summary".'
        ].join(' ')
      },
      { role: 'user', content: JSON.stringify({ summary: summaryEn }) }
    ]
  });

  const choice = completion.choices[0];
  if (choice?.finish_reason === 'length') {
    // Truncated mid-JSON. Parsing it would either throw or, worse,
    // succeed on half a sentence.
    throw new Error('truncated');
  }
  const raw = choice?.message?.content;
  if (!raw) throw new Error('empty response');

  const parsed = Translated.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`schema mismatch: ${parsed.error.message}`);
  return parsed.data;
}
