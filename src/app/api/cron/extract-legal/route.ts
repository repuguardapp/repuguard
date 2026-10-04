import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { alertOps } from '@/lib/alert';
import { isCronAuthorized } from '@/lib/cron-auth';
import { ANTHROPIC_EXTRACTION_MODEL, anthropic } from '@/lib/ai-clients';
import { fairShare } from '@/lib/fair-share';
import { recordModelUsage } from '@/lib/model-usage';
import { htmlToText } from '@/lib/feeds';
import { verifySpan } from '@/lib/policy-observations';
import { supabaseService } from '@/lib/supabase';
import { fetchExternal } from '@/lib/safe-fetch';

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

/**
 * How many times one item may fail before we stop paying to retry it.
 *
 * Three, then the row is parked as `extract_failed` with the last error
 * stored on it. Before this existed, a failure that was about our code
 * rather than about the page was retried for ever: the two items that
 * tripped the `evidence.fine_eur: null` parse were charged on every run
 * from 27 September, and the only visible trace was one alert per item
 * per run — a shape that hides a single bug inside what looks like
 * unrelated noise.
 *
 * Three rather than one because a 503 from a regulator's server, or a
 * model that returns no tool call once, is worth asking again. Only
 * item-level failures count: an exhausted balance or a rejected API key
 * abandons the run without touching the counter, because parking real
 * decisions over a billing lapse would be the expensive mistake in the
 * other direction.
 */
const MAX_EXTRACT_ATTEMPTS = 3;

/**
 * How much of a regulator's page the model is shown.
 *
 * It was 12,000 characters, taken from the front, and that is the same
 * mistake the policy crawler made with its 800,000: a cap applied to the
 * head is not a bound on size, it is a decision about which part of the
 * document to read.
 *
 * The ICO's enforcement pages carry the contravention first and the
 * money later — "ICO hits company selling call blockers with £190k fine
 * for nuisance calls" sits below the body text. The model answered "the
 * page does not state a fine amount or currency", which was a true
 * statement about the 12,000 characters it was given and a false one
 * about the page.
 *
 * Forty thousand now, and past that the page is read at both ends. A
 * regulator's decision is never 40,000 characters of substance, so the
 * tail is navigation on a short page and the amount on a long one —
 * and the tail is cheap: it is already in memory, and the model is
 * billed for about four thousand extra tokens on the rare page that
 * needs it.
 */
const MAX_SOURCE_CHARS = 40_000;

/** The end of a page too long to send whole. Where the ICO puts money. */
const SOURCE_TAIL_CHARS = 6_000;

const FETCH_TIMEOUT_MS = 15_000;

/**
 * An omitted field and an explicit null mean the same thing: absent.
 *
 * They did not, and it cost us. The tool schema says "omit the field
 * entirely" when there is no fine, and the model instead sent
 * `evidence: { fine_eur: null }` — which a plain `.optional()` rejects.
 * The parse threw, the item stayed `discovered`, and the next run picked
 * it up again: two developments charged four times a day from 27
 * September onward, each run producing one more alert naming one more
 * development id, so a single schema bug read as a stream of unrelated
 * item failures.
 *
 * A null where a key was expected to be missing is not a lie about the
 * world — it is the same claim in a different shape, and refusing it
 * teaches us nothing about the document. Every optional field accepts
 * both and normalises to undefined, so the distinction stops existing
 * before it can cost anything again.
 */
function absent<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .nullish()
    .transform((value) => (value === null ? undefined : value) as z.infer<T> | undefined);
}

const Extraction = z.object({
  relevant: z.boolean(),
  reject_reason: absent(z.string()),
  authority: absent(z.string()),
  entity: absent(z.string()),
  decision_date: absent(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  articles: absent(z.array(z.string())),
  fine_amount: absent(z.number().nonnegative()),
  fine_currency: absent(z.string().regex(/^[A-Za-z]{3}$/)),
  outcome: absent(
    z.enum(['fine', 'reprimand', 'ban', 'order', 'guidance', 'court_ruling', 'other'])
  ),
  summary_en: absent(z.string()),
  /**
   * Where each checkable fact came from, in the page's own words.
   *
   * Proposed by the model and then VERIFIED — see verifySpan below. A
   * quotation nobody checked is not evidence, it is a second assertion
   * from the same source that produced the first.
   */
  evidence: absent(
    z.object({
      entity: absent(z.string()),
      decision_date: absent(z.string()),
      fine_amount: absent(z.string())
    })
  )
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
          'True only for an enforcement decision, court ruling, or formal regulatory guidance on data protection or AI — something that has been DECIDED. False for press releases, recruitment, events, newsletters and consultations, and false for the announcement that an investigation or inquiry has been opened: an opened inquiry has found nothing, and "X Internet Unlimited Company — order" built from one is an accusation against a named company that no authority has made.'
      },
      reject_reason: { type: 'string', description: 'Why it is not relevant. Required when relevant is false.' },
      authority: { type: 'string', description: 'Issuing body, in English. e.g. "CNIL", "EDPB", "ICO".' },
      entity: {
        type: 'string',
        description:
          'The organisation the decision was taken AGAINST, exactly as the source names it and with no descriptive words added: "EXTIA", "Hopital Prive de la Loire", "Meta Platforms Ireland". Not the authority, not a sector, not a category. Omit the field entirely for guidance, opinions, consultations and anything with no respondent — and omit it rather than guess when the source only alludes to "a company" or "a hospital", because this name goes in the headline of a public page in seven languages.'
      },
      decision_date: {
        type: 'string',
        description:
          'ISO date YYYY-MM-DD of the DECISION itself, not of its announcement. Regulators routinely publish weeks after ruling: a CNIL page opens "Le 3 septembre 2026, la CNIL a prononcé une sanction" while its own reference at the foot reads "Délibération n°SAN-2026-009 du 21 juillet 2026". When the source gives a deliberation, judgment or decision reference with its own date, that date wins over the date in the prose. Omit the field entirely if no date is stated.'
      },
      articles: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Provisions the source NAMES IN SO MANY WORDS, with the instrument in ENGLISH and the number exactly as given. A French source writing "RGPD Art. 12" becomes "GDPR Art. 12"; the same for LGPD, APPI and the Gulf regimes. Keep sub-paragraphs when the source uses them: "Art. 9(2)", not "Art. 9". NEVER infer an article from the subject matter — guidelines on anonymisation are ABOUT the definition of personal data, but if the page does not write "Article 4" then Article 4 is not cited and does not belong here. An empty list is the correct answer for a page that discusses concepts without citing provisions. e.g. ["GDPR Art. 13", "GDPR Art. 32"].'
      },
      fine_amount: {
        type: 'number',
        description:
          'The amount of the fine EXACTLY as the source states it, in the source\'s own currency. Digits only, no symbol, no separators: an ICO penalty written "£963,900" is 963900. NEVER convert between currencies — not to euros, not to anything. If the source says £66,000, the answer is 66000 with fine_currency GBP, and 73920 is a number that exists in no document. Omit both fields entirely if no fine was imposed, or if you cannot tell which currency the amount is in.'
      },
      fine_currency: {
        type: 'string',
        description:
          'ISO 4217 code of the currency the SOURCE uses: GBP for the ICO, EUR for the CNIL and the EDPB, JPY for the PPC, BRL for the ANPD. Required whenever fine_amount is given, and omitted whenever it is not. Read it from the symbol or the word in the document; do not infer it from which country the authority is in — a reprimand published by an EU body may still quote a sum in another currency.'
      },
      outcome: { type: 'string', enum: ['fine', 'reprimand', 'ban', 'order', 'guidance', 'court_ruling', 'other'] },
      summary_en: {
        type: 'string',
        description:
          'Two to four sentences of ORIGINAL English prose stating what was decided and against whom. Facts only. Do not copy sentences from the source. No advice, no interpretation, no prediction.'
      },
      evidence: {
        type: 'object',
        description:
          'For each of the three fields a human has to check, the sentence from the source that states it — COPIED EXACTLY, in the source language, punctuation and accents included. This is the one place where copying from the source is required rather than forbidden: it is checked character by character against the page, and a span that cannot be found there is discarded. Do not paraphrase, do not translate, do not join two sentences with an ellipsis. Omit a field whose value you did not take from an explicit statement.',
        properties: {
          entity: { type: 'string', description: 'The sentence naming the organisation the decision was taken against.' },
          decision_date: { type: 'string', description: 'The sentence or reference line stating the date of the decision.' },
          fine_amount: {
            type: 'string',
            description: 'The sentence stating the amount, with its currency symbol or word intact.'
          }
        }
      }
    },
    required: ['relevant']
  }
};

const SYSTEM = [
  'You extract facts from regulatory publications on data protection and AI.',
  'The organisation sanctioned is the single most important field: name it',
  'exactly as the source does, or omit it. Never infer it, never paraphrase it.',
  'You are not a commentator. You state what a document says and nothing more:',
  'no advice, no interpretation, no speculation about consequences.',
  'Never assert a fact the source does not state — omit the field instead.',
  'This applies hardest to article numbers: a provision that is thematically',
  'obvious but textually absent is an inference, and inferences are published',
  'as though we had read them in the text.',
  'A publication date is not a decision date. Prefer the date carried by',
  'the formal act — deliberation, judgment, decision reference — over the',
  'date the announcement was written.',
  'Name statutes by their English abbreviation even when the source is in',
  'another language, so the corpus reads consistently across all of it.',
  'You NEVER convert a currency. An amount is reported in the currency the',
  'document uses, with its ISO code, and a sum you cannot attribute to a',
  'currency is omitted. Converting £66,000 into 73,920 produced a figure',
  'that appears in no document anywhere, attached to the name of a police',
  'force — the exact failure every other rule here exists to prevent.',
  'An investigation or inquiry that has been OPENED is not a decision and',
  'not relevant: nothing has been found, and a page saying otherwise about',
  'a named organisation is an accusation we invented.',
  'The summary must be your own sentences, not the source\'s, and must contain',
  'only what the source establishes.'
].join(' ');

interface DevelopmentRow {
  id: string;
  /** Which feed it came from — the key the extraction budget is shared on. */
  source_id: string;
  primary_url: string;
  raw_title: string;
  raw_excerpt: string | null;
  published_at: string | null;
  /** Failed attempts so far. At MAX_EXTRACT_ATTEMPTS the row is parked. */
  extract_attempts: number | null;
}

export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return extract();
}

export async function POST(request: Request) {
  if (!(await isCronAuthorized(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return extract();
}

async function extract() {
  const db = supabaseService();

  // A wider slice than we will extract, so the round-robin below has
  // something to choose between. Still ordered newest first: within a
  // source, a decision published this morning matters more than one from
  // March.
  const { data, error } = await db
    .from('legal_developments')
    .select('id, source_id, primary_url, raw_title, raw_excerpt, published_at, extract_attempts')
    .eq('status', 'discovered')
    // An item that has used its attempts is not in the queue any more. It
    // is also not in `discovered` any more, so this is a belt-and-braces
    // filter — one that matters on the run that follows a deploy, when
    // rows written by the previous version have attempts but no status.
    .lt('extract_attempts', MAX_EXTRACT_ATTEMPTS)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(MAX_ITEMS_PER_RUN * 12);

  if (error) {
    console.error('[cron/extract-legal] queue_unreadable', { error: error.message });
    alertOps('cron.extract_legal_queue_unreadable', { error: error.message });
    return NextResponse.json({ error: 'queue_unreadable', detail: error.message }, { status: 500 });
  }

  const queue = fairShare((data ?? []) as DevelopmentRow[], MAX_ITEMS_PER_RUN);
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
      const detail = err instanceof Error ? err.message : String(err);

      // Some failures are not about this item at all.
      //
      // The Anthropic balance ran out on 27 September and the loop kept
      // going: eight items a run, four runs a day, seventy-two identical
      // alerts in two days, each naming a different development id as
      // though the developments were the problem. Nobody reads an alert
      // channel that repeats one outage seventy-two times, and the
      // failure that mattered was invisible inside them.
      //
      // So an account-level error stops the batch, says so once, and
      // names what has to happen. The remaining items stay `discovered`
      // and are picked up whenever the account works again — no state to
      // unwind, because none was written.
      const fatal = accountLevelFailure(detail);
      if (fatal) {
        console.error('[cron/extract-legal] run_abandoned', { reason: fatal });
        alertOps('cron.extract_legal_account_blocked', { reason: fatal, remaining: queue.length - stats.extracted - stats.rejected - stats.failed });
        return NextResponse.json({ ok: false, reason: fatal, ...stats }, { status: 200 });
      }

      // Otherwise: one item must never cost the rest of the batch, and it
      // must not be retried for ever either. The attempt is counted, and
      // on the third one the row leaves the queue carrying its own reason.
      const attempts = (item.extract_attempts ?? 0) + 1;
      const parked = attempts >= MAX_EXTRACT_ATTEMPTS;

      await db
        .from('legal_developments')
        .update({
          extract_attempts: attempts,
          ...(parked
            ? { status: 'extract_failed', extract_error: detail }
            : { extract_error: detail }),
          updated_at: new Date().toISOString()
        })
        .eq('id', item.id);

      console.error('[cron/extract-legal] item_failed', {
        id: item.id,
        attempts,
        parked,
        error: detail
      });

      // Alerted once, on the attempt that gives up. The first two are in
      // the log and in the row; it is the giving up that somebody has to
      // act on, and alerting all three is how a channel earns the habit
      // of being ignored.
      if (parked) {
        alertOps('cron.extract_legal_item_parked', {
          developmentId: item.id,
          url: item.primary_url,
          attempts,
          error: detail
        });
      }

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

  // Before anything can fail: what this call actually cost. Awaited
  // rather than fired and forgotten, because a serverless instance
  // freezes the moment the handler returns and an unawaited write is a
  // ledger with holes in it exactly where the interesting calls were.
  await recordModelUsage({
    purpose: 'extract_legal',
    model: ANTHROPIC_EXTRACTION_MODEL,
    usage: message.usage
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

  // Two sources, one decision. The uniqueness key is
  // (source_id, external_id), which makes polling idempotent per feed
  // and does nothing across feeds — so the CNIL fine against EXTIA
  // arrived twice, once from cnil.fr and once from the EDPB newsroom
  // that republishes it. Two rows would become two pages describing
  // the same decision, which is duplicate content on our own domain:
  // the pages compete with each other and the corpus looks padded.
  //
  // The facts are what identify a decision, so they are what we
  // deduplicate on: same authority, same date, same amount. Checked
  // here rather than with a database constraint because the facts only
  // exist once extraction has run, and because the loser must be
  // recorded as a duplicate rather than rejected by a failed insert
  // nobody can read afterwards.
  const twin = await findTwin(db, item.id, out);
  if (twin) {
    await db
      .from('legal_developments')
      .update({
        status: 'rejected',
        rejected_reason: `duplicate of ${twin} (same authority, date and amount, reported by another source)`,
        updated_at: new Date().toISOString()
      })
      .eq('id', item.id);
    stats.rejected += 1;
    return;
  }

  await db
    .from('legal_developments')
    .update({
      status: 'extracted',
      authority: out.authority ?? null,
      entity: out.entity?.trim() || null,
      decision_date: out.decision_date ?? null,
      articles: out.articles ?? null,
      // Both or neither — the database enforces it too. An amount whose
      // currency we did not read is not a smaller fact than no amount,
      // it is a different one, and it is the one that put nine pound
      // figures in a column named for euros.
      fine_amount: out.fine_amount !== undefined && out.fine_currency ? out.fine_amount : null,
      fine_currency:
        out.fine_amount !== undefined && out.fine_currency
          ? out.fine_currency.toUpperCase()
          : null,
      outcome: out.outcome ?? null,
      summary_en: out.summary_en.trim(),
      // Verified against the page, and what is stored is the page's
      // wording rather than the model's. An unverifiable span is dropped
      // silently: its absence means the reviewer opens the source, which
      // is where they were anyway before this existed.
      evidence: verifiedEvidence(sourceText, out.evidence),
      slug: slugFor(item),
      updated_at: new Date().toISOString()
    })
    .eq('id', item.id);

  stats.extracted += 1;
}

/**
 * Another row describing the same decision, if one exists.
 *
 * Only rows that are still alive count: a previous duplicate that was
 * itself rejected must not make a third copy look like a duplicate of
 * something nobody can see.
 *
 * A decision with no date and no amount has nothing to match on, so it
 * is never treated as a duplicate — guessing there would silently drop
 * a real decision, which is far worse than publishing one twice.
 *
 * THE COMMENT ABOVE WAS TRUE AND THE CODE DID NOT DO IT
 *
 * The amounts were compared with `mine === theirs`, and two nulls are
 * equal in JavaScript. So an absence became a matching key, which is the
 * one thing this comment says must never happen.
 *
 * The ICO published two documents about Elderly Aids Limited on the same
 * day: an enforcement notice, which orders the company to stop, and a
 * monetary penalty notice of £190,000. Same authority, same date,
 * neither carrying an amount we had managed to read — so on 20 September
 * the penalty notice was rejected as "duplicate of" the enforcement
 * notice, and the fine left the corpus while the order stayed. Nobody
 * saw it, because a rejection with a reason reads like the system
 * working.
 *
 * Two guards now. An absent amount never matches anything, and two rows
 * with different outcomes are never the same decision — an order and a
 * fine are two decisions however identical their metadata, which is
 * precisely how a regulator works.
 */
async function findTwin(
  db: ReturnType<typeof supabaseService>,
  selfId: string,
  facts: z.infer<typeof Extraction>
): Promise<string | null> {
  if (!facts.authority || !facts.decision_date) return null;

  // Nothing to match on. Two decisions by one authority on one day with
  // no amount between them are two decisions until something says
  // otherwise, and silence is not that something.
  if (facts.fine_amount === undefined || !facts.fine_currency) return null;

  const { data, error } = await db
    .from('legal_developments')
    .select('id, fine_amount, fine_currency, outcome')
    .eq('authority', facts.authority)
    .eq('decision_date', facts.decision_date)
    .in('status', ['extracted', 'approved', 'published'])
    .neq('id', selfId);
  if (error) return null;

  const rows =
    (data as
      | {
          id: string;
          fine_amount: number | null;
          fine_currency: string | null;
          outcome: string | null;
        }[]
      | null) ?? [];

  const mineCurrency = facts.fine_currency!.toUpperCase();

  const match = rows.find((r) => {
    // A row with no amount is not a candidate. It is the other half of
    // the guard above: the comparison must never be satisfied by two
    // absences agreeing with each other.
    if (r.fine_amount === null || !r.fine_currency) return false;

    // An order and a fine are two decisions, however identical the rest
    // of their metadata — which is exactly how a regulator publishes:
    // one notice telling a company to stop, one notice telling it what
    // to pay, same day, same authority.
    if ((r.outcome ?? null) !== (facts.outcome ?? null)) return false;

    // The currency is part of the amount. Two decisions by the same body
    // on the same day, one for 300000 GBP and one for 300000 EUR, are two
    // decisions, and matching on the digits alone would reject the second
    // as a duplicate of the first.
    return Number(r.fine_amount) === facts.fine_amount && r.fine_currency === mineCurrency;
  });
  return match?.id ?? null;
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
    const res = await fetchExternal(item.primary_url, {
      headers: { 'user-agent': 'LexyFlowLegalWatch/1.0 (+https://lexyflow.com)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store'
    });
    if (!res.ok) return fallback;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('html')) return fallback;

    // Extracted whole, then trimmed at both ends rather than only at the
    // front. htmlToText is given a generous ceiling so the decision of
    // what to keep is made here, in one place, where it can be read.
    const whole = htmlToText(await res.text(), 400_000);
    const text =
      whole.length <= MAX_SOURCE_CHARS
        ? whole
        : `${whole.slice(0, MAX_SOURCE_CHARS)}\n\n[...]\n\n${whole.slice(-SOURCE_TAIL_CHARS)}`;

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

/**
 * Keep only the spans that are actually in the document.
 *
 * verifySpan is the same function the policy scan uses, and it does the
 * one thing that makes a quotation worth anything: it finds the proposal
 * in the source and returns THE SOURCE's characters. What ends up in the
 * review queue is therefore the regulator's sentence, not the model's
 * recollection of it — and a model that invents a supporting quote
 * produces nothing here rather than a convincing one.
 *
 * Returns null rather than an empty object when nothing survives, so the
 * column distinguishes "no evidence offered" from "{}".
 */
function verifiedEvidence(
  sourceText: string,
  proposed:
    | Partial<Record<'entity' | 'decision_date' | 'fine_amount', string | undefined>>
    | undefined
): Record<string, string> | null {
  if (!proposed) return null;

  const verified: Record<string, string> = {};
  for (const [field, span] of Object.entries(proposed)) {
    if (!span) continue;
    const found = verifySpan(sourceText, span);
    if (found) verified[field] = found;
  }

  return Object.keys(verified).length > 0 ? verified : null;
}

/**
 * Is this failure about the account rather than about the item?
 *
 * A model that refuses because the balance is empty or the key is
 * rejected will refuse the next seven items for the same reason, and the
 * one after that. Retrying inside the same run costs nothing in money and
 * everything in signal: the outage arrives as a stream of per-item alerts
 * that each name a different development, which is how a channel stops
 * being read.
 *
 * Matched on the message because that is what the SDK gives us — the
 * status code alone does not distinguish "your credit balance is too low"
 * (a 400) from a malformed request (also a 400), and those need opposite
 * responses.
 */
function accountLevelFailure(message: string): string | null {
  if (/credit balance is too low/i.test(message)) {
    return 'the Anthropic credit balance is exhausted — no extraction can run until it is topped up';
  }
  if (/authentication_error|invalid x-api-key|401/i.test(message)) {
    return 'the Anthropic API key is being rejected';
  }
  if (/permission_error|403/i.test(message)) {
    return 'the Anthropic account is not permitted to use this model';
  }
  return null;
}
