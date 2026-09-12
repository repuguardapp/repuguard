import { NextResponse } from 'next/server';
import { z } from 'zod';
import { alertOps } from '@/lib/alert';
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

const Translated = z.object({
  title: z.string().min(1),
  summary: z.string().min(1)
});

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

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return process.env.NODE_ENV !== 'production';
  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${expected}`) return true;
  return new URL(request.url).searchParams.get('secret') === expected;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return localize();
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
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

  const titleEn = buildTitle(item);

  // The six run concurrently: same token count, a fraction of the wall
  // clock, and each one's failure is independent until we collect them.
  const results = await Promise.allSettled(
    TARGET_LOCALES.map((locale) => translate(titleEn, item.summary_en!, locale))
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
    { development_id: item.id, locale: 'en', title: titleEn, summary: item.summary_en },
    ...TARGET_LOCALES.map((locale, i) => {
      const value = (results[i] as PromiseFulfilledResult<z.infer<typeof Translated>>).value;
      return {
        development_id: item.id,
        locale,
        title: value.title,
        summary: value.summary
      };
    })
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
 * Our own headline, assembled from the facts.
 *
 * Never the regulator's — their headline is their prose. These are
 * facts, which carry no copyright, and the result is more useful than
 * a borrowed title: consistent across the whole corpus, and carrying
 * the terms a compliance officer actually searches for.
 */
function buildTitle(item: ApprovedRow): string {
  const parts: string[] = [];
  parts.push(item.authority ?? 'Regulator');

  if (item.fine_eur !== null && item.fine_eur > 0) {
    const amount = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0
    }).format(item.fine_eur);
    parts.push(`${amount} fine`);
  } else if (item.outcome) {
    parts.push(item.outcome.replace(/_/g, ' '));
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
  titleEn: string,
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
          'Return JSON with exactly the keys "title" and "summary".'
        ].join(' ')
      },
      { role: 'user', content: JSON.stringify({ title: titleEn, summary: summaryEn }) }
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
