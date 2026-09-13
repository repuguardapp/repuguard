import { NextResponse } from 'next/server';
import { alertOps } from '@/lib/alert';
import { isCronAuthorized } from '@/lib/cron-auth';
import { parseFeed } from '@/lib/feeds';
import { supabaseService } from '@/lib/supabase';

/**
 * Legal watch — the intake of the Acquisition brain.
 *
 * Polls the regulator feeds in `legal_sources` and records what it
 * finds in `legal_developments` as `discovered`. It does nothing else:
 * no extraction, no translation, no publishing. Intake that also
 * interprets is intake you cannot debug.
 *
 * Idempotent by construction — (source_id, external_id) is unique, so
 * the same item found on a hundred consecutive runs inserts once. That
 * is what lets this run every six hours without any cursor state.
 *
 * What it stores is deliberately thin: an id, a link to the primary
 * source, a date, and the feed's own title and excerpt as extraction
 * INPUT. Source prose is never rendered and never indexed. Facts are
 * not copyrightable; a regulator's paragraphs are.
 *
 * Per-source isolation is the point of the loop: a regulator who moves
 * a URL, serves HTML instead of XML, or goes down must cost us that
 * source for one run, never the others. The failure is written onto
 * the source row so it is visible in one query rather than inferred
 * from an absence of rows — the failure mode this whole codebase keeps
 * relearning.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Feeds are small; anything slower than this is a source that is down. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Newest N entries per source per run. Regulator feeds carry 20-50
 * items and we poll four times a day, so this is never a limit in
 * steady state — it is a bound on the first run against a fat feed.
 */
const MAX_ITEMS_PER_SOURCE = 40;

/**
 * Consecutive failures before a source switches itself off.
 *
 * A feed that no longer exists would otherwise alert four times a day,
 * for ever. That is how an alerting channel stops being read, and it
 * would discredit the alerts that matter alongside it — the ICO
 * withdrew every one of its RSS feeds pending a redesign, so ours was
 * never coming back.
 *
 * Five runs is a day and a quarter: long enough that a regulator's
 * maintenance window or a bad afternoon does not disable anything,
 * short enough that a genuinely dead feed goes quiet within two days.
 * Re-enabling is deliberate, which is right — a dead feed returns only
 * when somebody has found its replacement.
 */
const DISABLE_AFTER_CONSECUTIVE_FAILURES = 5;

interface SourceRow {
  id: string;
  name: string;
  feed_url: string;
  licence: string;
  consecutive_failures: number | null;
}

interface SourceResult {
  source: string;
  ok: boolean;
  discovered: number;
  skipped: number;
  error?: string;
  /** Set when this run was the one that switched the source off. */
  disabled?: boolean;
}

export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return watch();
}

export async function POST(request: Request) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return watch();
}

async function watch() {
  const db = supabaseService();

  const { data, error } = await db
    .from('legal_sources')
    .select('id, name, feed_url, licence, consecutive_failures')
    .eq('enabled', true);

  if (error) {
    console.error('[cron/watch-legal] sources_unreadable', { error: error.message });
    alertOps('cron.watch_legal_sources_unreadable', { error: error.message });
    return NextResponse.json({ error: 'sources_unreadable', detail: error.message }, { status: 500 });
  }

  const sources = (data ?? []) as SourceRow[];
  const results: SourceResult[] = [];

  for (const source of sources) {
    results.push(await pollSource(db, source));
  }

  const failed = results.filter((r) => !r.ok);
  const discovered = results.reduce((n, r) => n + r.discovered, 0);

  if (failed.length > 0) {
    // A source that stops reporting looks exactly like a regulator
    // having a quiet month. Only the alert tells the two apart.
    console.warn('[cron/watch-legal] sources_failed', { failed: failed.map((f) => f.source) });
    alertOps('cron.watch_legal_source_failed', {
      failed: failed.map((f) => ({ source: f.source, error: f.error }))
    });
  }
  if (discovered > 0) {
    console.log('[cron/watch-legal] discovered', { discovered });
  }

  return NextResponse.json({ ok: failed.length === 0, discovered, results });
}

async function pollSource(
  db: ReturnType<typeof supabaseService>,
  source: SourceRow
): Promise<SourceResult> {
  const stamp = async (patch: Record<string, unknown>) => {
    await db
      .from('legal_sources')
      .update({ last_polled_at: new Date().toISOString(), ...patch })
      .eq('id', source.id);
  };

  /**
   * Record a failure, and switch the source off once it has failed
   * often enough that it is not coming back on its own.
   */
  const fail = async (error: string): Promise<SourceResult> => {
    const streak = (source.consecutive_failures ?? 0) + 1;
    const giveUp = streak >= DISABLE_AFTER_CONSECUTIVE_FAILURES;
    await stamp({
      last_status: 'error',
      last_error: error,
      consecutive_failures: streak,
      ...(giveUp
        ? {
            enabled: false,
            disabled_reason: `Auto-disabled after ${streak} consecutive failures. Last error: ${error}`
          }
        : {})
    });
    if (giveUp) {
      console.warn('[cron/watch-legal] source_auto_disabled', { source: source.id, streak, error });
      // Said once, at the moment it happens. After this the source is
      // disabled and silent — which is the whole point.
      alertOps('cron.watch_legal_source_disabled', { source: source.id, streak, error });
    }
    return {
      source: source.id,
      ok: false,
      discovered: 0,
      skipped: 0,
      error,
      ...(giveUp ? { disabled: true } : {})
    };
  };

  let xml: string;
  try {
    const res = await fetch(source.feed_url, {
      // Identify ourselves. A regulator blocking an anonymous scraper
      // is entirely reasonable, and a contactable user agent is the
      // difference between being rate-limited and being banned.
      headers: { 'user-agent': 'LexyFlowLegalWatch/1.0 (+https://lexyflow.com)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store'
    });
    if (!res.ok) return await fail(`http_${res.status}`);
    xml = await res.text();
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err));
  }

  const { items, skipped } = parseFeed(xml);
  if (items.length === 0) {
    // Reaching a URL that yields nothing usable is a failure, not a
    // quiet day: it is what a moved feed serving an HTML redirect page
    // looks like. Saying "ok, 0 items" here is how a dead source stays
    // dead for months.
    return await fail(`no_items (skipped ${skipped}, ${xml.length} bytes)`);
  }

  const rows = items.slice(0, MAX_ITEMS_PER_SOURCE).map((item) => ({
    source_id: source.id,
    external_id: item.externalId,
    primary_url: item.link,
    published_at: item.publishedAt,
    raw_title: item.title,
    raw_excerpt: item.excerpt,
    status: 'discovered'
  }));

  // ignoreDuplicates leans on the (source_id, external_id) unique key:
  // already-known items are left exactly as they are, including any
  // review a human has since done to them. An upsert that overwrote
  // would silently reset an approved item back to the feed's wording.
  const { data: inserted, error: insertErr } = await db
    .from('legal_developments')
    .upsert(rows, { onConflict: 'source_id,external_id', ignoreDuplicates: true })
    .select('id');

  if (insertErr) return await fail(insertErr.message);

  // A success clears the streak: an intermittent feed must never creep
  // up to the threshold over weeks of alternating runs.
  await stamp({ last_status: 'ok', last_error: null, consecutive_failures: 0 });
  return {
    source: source.id,
    ok: true,
    discovered: (inserted ?? []).length,
    skipped
  };
}
