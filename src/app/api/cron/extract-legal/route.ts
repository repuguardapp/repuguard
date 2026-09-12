import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { alertOps } from '@/lib/alert';
import { ANTHROPIC_EXTRACTION_MODEL, anthropic } from '@/lib/ai-clients';
import { htmlToText } from '@/lib/feeds';
import { supabaseService } from '@/lib/supabase';

/**
 * Legal watch, pass 2 — turn a discovered item into structured facts.
 *
 * Reads the regulator's own page and pulls out the five things a
 * compliance officer searches for: which authority, what date, which
 * articles, how much, what outcome. Plus one short summary written in
 * our own words, in the English pivot, which pass 3 will localise
 * through the same engine the audits use.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not interpret. No "what this means for your business", no
 * advice, no prediction. We would be a compliance company publishing
 * unreviewed legal opinion under its own brand, in seven languages —
 * the "confidently wrong" failure we spent four days removing from the
 * product, relocated to the open web where it cannot be quietly fixed.
 * Facts with a link to the primary source are also what makes a page
 * worth linking to, so the cautious choice and the effective one agree.
 *
 * It does not publish. Output lands in `extracted` and waits for a
 * human. Google's scaled-content-abuse policy applies site-wide, not
 * page-wide: an auto-published farm would put the ~266 programmatic
 * pages that already work at risk.
 *
 * COST
 *
 * One model call per item, on the cheap extraction model, hard-capped
 * per run. The model is also the filter: a regulator's feed carries
 * recruitment notices and event announcements, and asking for
 * relevance in the same call we were already paying for costs nothing
 * extra and leaves an auditable reason on every rejection.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Items per run. The real bound on spend.
 *
 * Steady state is a handful of publications a day across four
 * regulators, so this is never reached once the backlog is cleared —
 * it exists for the first run against four full feeds (up to 160
 * items), which it drains over a few days instead of in one invoice.
 */
const MAX_ITEMS_PER_RUN = 8;

/** Regulator pages are articles; anything larger is navigation furniture. */
const MAX_SOURCE_CHARS = 12_000;
const FETCH_TIMEOUT_MS = 15_000;

const Extraction = z.object({
  relevant: z.boolean(),
  reject_reason: z.string().optional(),
  authority: z.string().optional(),
  decision_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  articles: z.array(z.string()).optional(),
  fine_eur: z.number().nonnegative().optional(),
  outcome: z.enum(['fine', 'reprimand', 'ban', 'order', 'guidance', 'court_ruling', 'other']).optional(),
  summary_en: z.string().optional()
});

const TOOL = {
  name: 'submit_development',
  description: 'Record the facts of one regulatory development, or reject it as not relevant.',
  input_schema: {
    type: 'object' as const,
    properties: {
      relevant: {
        type: 'boolean',
        description:
          'True only for an enforcement decision, court ruling, or formal regulatory guidance on data protection or AI. False for press releases, recruitment, events, newsletters, and consultations.'
      },
      reject_reason: { type: 'string', description: 'Why it is not relevant. Required when relevant is false.' },
      authority: { type: 'string', description: 'Issuing body, in English. e.g. "CNIL", "EDPB", "ICO".' },
      decision_date: { type: 'string', description: 'ISO date YYYY-MM-DD. Omit if the source does not state one.' },
      articles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Provisions cited, as the source writes them. e.g. ["GDPR Art. 13", "GDPR Art. 32"].'
      },
      fine_eur: { type: 'number', description: 'Fine in euros. Omit entirely if no fine, or if the currency is not euros.' },
      outcome: { type: 'string', enum: ['fine', 'reprimand', 'ban', 'order', 'guidance', 'court_ruling', 'other'] },
      summary_en: {
        type: 'string',
        description:
          'Two to four sentences of ORIGINAL English prose stating what was decided and against whom. Facts only. Do not copy sentences from the source. No advice, no interpretation, no prediction.'
      }
    },
    required: ['relevant']
  }
};

const SYSTEM = [
  'You extract facts from regulatory publications on data protection and AI.',
  'You are not a commentator. You state what a document says and nothing more:',
  'no advice, no interpretation, no speculation about consequences.',
  'Never assert a fact the source does not state — omit the field instead.',
  'The summary must be your own sentences, not the source\'s, and must contain',
  'only what the source establishes.'
].join(' ');

interface DevelopmentRow {
  id: string;
  primary_url: string;
  raw_title: string;
  raw_excerpt: string | null;
  published_at: string | null;
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
  return extract();
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return extract();
}

async function extract() {
  const db = supabaseService();

  const { data, error } = await db
    .from('legal_developments')
    .select('id, primary_url, raw_title, raw_excerpt, published_at')
    .eq('status', 'discovered')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(MAX_ITEMS_PER_RUN);

  if (error) {
    console.error('[cron/extract-legal] queue_unreadable', { error: error.message });
    alertOps('cron.extract_legal_queue_unreadable', { error: error.message });
    return NextResponse.json({ error: 'queue_unreadable', detail: error.message }, { status: 500 });
  }

  const queue = (data ?? []) as DevelopmentRow[];
  // Spend nothing on an empty queue. This runs on a schedule whether or
  // not a regulator published anything, which is most of the time.
  if (queue.length === 0) {
    return NextResponse.json({ ok: true, extracted: 0, rejected: 0, failed: 0, note: 'queue empty' });
  }

  const stats = { extracted: 0, rejected: 0, failed: 0 };

  for (const item of queue) {
    try {
      await extractOne(db, item, stats);
    } catch (err) {
      // One item must never cost the rest of the batch. The row stays
      // `discovered`, so the next run retries it — and if it keeps
      // failing it keeps being retried, which is why the failure is
      // alerted rather than only counted.
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[cron/extract-legal] item_failed', { id: item.id, error: detail });
      alertOps('cron.extract_legal_item_failed', { developmentId: item.id, error: detail });
      stats.failed += 1;
    }
  }

  console.log('[cron/extract-legal] run complete', stats);
  return NextResponse.json({ ok: true, ...stats });
}

async function extractOne(
  db: ReturnType<typeof supabaseService>,
  item: DevelopmentRow,
  stats: { extracted: number; rejected: number; failed: number }
): Promise<void> {
  const sourceText = await readSource(item);

  const message = await anthropic().messages.create({
    model: ANTHROPIC_EXTRACTION_MODEL,
    max_tokens: 1024,
    temperature: 0,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [
      {
        role: 'user',
        content: `Source: ${item.primary_url}\nHeadline: ${item.raw_title}\n\n${sourceText}`
      }
    ]
  });

  const call = message.content.find((block) => block.type === 'tool_use');
  if (!call || call.type !== 'tool_use') {
    throw new Error(`model returned no tool call (stop_reason=${message.stop_reason})`);
  }

  const parsed = Extraction.safeParse(call.input);
  if (!parsed.success) {
    throw new Error(`extraction schema mismatch: ${parsed.error.message}`);
  }
  const out = parsed.data;

  // Rejection is a normal outcome, not a failure. Most of a regulator's
  // feed is not an enforcement decision, and recording why keeps the
  // filter auditable instead of silently dropping items.
  if (!out.relevant) {
    await db
      .from('legal_developments')
      .update({
        status: 'rejected',
        rejected_reason: out.reject_reason ?? 'not a regulatory development',
        updated_at: new Date().toISOString()
      })
      .eq('id', item.id);
    stats.rejected += 1;
    return;
  }

  // A "relevant" item with no summary has nothing to publish. Treat it
  // as a failed extraction and let the next run retry, rather than
  // promoting an empty row into the review queue for a human to puzzle
  // over.
  if (!out.summary_en || out.summary_en.trim().length < 40) {
    throw new Error('relevant item returned without a usable summary');
  }

  await db
    .from('legal_developments')
    .update({
      status: 'extracted',
      authority: out.authority ?? null,
      decision_date: out.decision_date ?? null,
      articles: out.articles ?? null,
      fine_eur: out.fine_eur ?? null,
      outcome: out.outcome ?? null,
      summary_en: out.summary_en.trim(),
      slug: slugFor(item),
      updated_at: new Date().toISOString()
    })
    .eq('id', item.id);

  stats.extracted += 1;
}

/**
 * The regulator's own page, falling back to what the feed gave us.
 *
 * The excerpt alone is usually enough for the headline fact but rarely
 * carries the articles cited, so the page is worth fetching. It is not
 * worth failing over: a PDF, a consent wall or a timeout should
 * degrade to a thinner extraction, not park the item for ever.
 */
async function readSource(item: DevelopmentRow): Promise<string> {
  const fallback = [item.raw_title, item.raw_excerpt ?? ''].join('\n\n').trim();
  try {
    const res = await fetch(item.primary_url, {
      headers: { 'user-agent': 'LexyFlowLegalWatch/1.0 (+https://lexyflow.com)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store'
    });
    if (!res.ok) return fallback;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('html')) return fallback;
    const text = htmlToText(await res.text(), MAX_SOURCE_CHARS);
    // A page that reduces to almost nothing is a JS shell or a consent
    // wall; the feed excerpt is better than its navigation menu.
    return text.length > fallback.length ? text : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Deterministic slug, built in code rather than asked of the model.
 *
 * A URL is an identity: it must be stable across re-extractions and
 * unique without a retry loop. Model-generated slugs are neither —
 * two decisions on the same day against the same company would
 * plausibly produce the same words, and re-running extraction after a
 * prompt change would silently move a page that may already be
 * indexed. The hash of the row id gives uniqueness the database does
 * not have to enforce twice.
 */
function slugFor(item: DevelopmentRow): string {
  const words = item.raw_title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  const hash = createHash('sha256').update(item.id).digest('hex').slice(0, 6);
  return words.length > 0 ? `${words}-${hash}` : hash;
}
