import { NextResponse } from 'next/server';
import { alertOps } from '@/lib/alert';
import { isCronAuthorized } from '@/lib/cron-auth';
import { composeDigest, type DigestInput } from '@/lib/daily-digest';
import { sendOpsDigest } from '@/lib/email';
import { supabaseService } from '@/lib/supabase';
import { appUrl } from '@/lib/app-url';

/**
 * Pillar three of Jarvis — the operational brain.
 *
 * Sentry covers failures loud enough to throw. This covers the ones
 * this system is actually prone to, which are all silent: a feed that
 * stopped returning items, a review queue nobody opened, a month with
 * no revenue. Every one of those looks exactly like a quiet week.
 *
 * Every figure is read independently and a failed read reports itself
 * as unavailable rather than as zero. That distinction is the whole
 * point: a digest that prints 0 audits when the query failed teaches
 * its reader to distrust it, and a digest nobody trusts is worse than
 * none because it still consumes the attention it was built to save.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Sweep window from /api/cron/reap-audits — same definition of stuck. */
const STUCK_AFTER_MINUTES = 20;

export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return digest();
}

export async function POST(request: Request) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return digest();
}

/** Count rows, or null when the query failed. Never a silent zero. */
async function count(build: () => PromiseLike<{ count: number | null; error: unknown }>) {
  try {
    const { count: value, error } = await build();
    return error ? null : (value ?? 0);
  } catch {
    return null;
  }
}

async function digest() {
  const db = supabaseService();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const stuckCutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000).toISOString();
  const baseUrl = appUrl();

  const [
    auditsCompleted,
    auditsFailed,
    auditsStuck,
    creditsConsumed,
    newOrganizations,
    activeSubscriptions,
    awaitingReview
  ] = await Promise.all([
    count(() =>
      db.from('audits').select('id', { head: true, count: 'exact' }).eq('status', 'completed').gte('created_at', since)
    ),
    count(() =>
      db.from('audits').select('id', { head: true, count: 'exact' }).eq('status', 'failed').gte('created_at', since)
    ),
    count(() =>
      db
        .from('audits')
        .select('id', { head: true, count: 'exact' })
        .in('status', ['pending', 'running'])
        .lt('created_at', stuckCutoff)
    ),
    count(() =>
      db
        .from('audits')
        .select('id', { head: true, count: 'exact' })
        .eq('credit_consumed', true)
        .gte('created_at', since)
    ),
    count(() =>
      db.from('organizations').select('id', { head: true, count: 'exact' }).gte('created_at', since)
    ),
    count(() =>
      db
        .from('subscriptions')
        .select('organization_id', { head: true, count: 'exact' })
        .in('status', ['active', 'trialing', 'past_due'])
    ),
    count(() =>
      db
        .from('legal_developments')
        .select('id', { head: true, count: 'exact' })
        .eq('status', 'extracted')
    )
  ]);

  const input: DigestInput = {
    auditsCompleted,
    auditsFailed,
    auditsStuck,
    creditsConsumed,
    newOrganizations,
    activeSubscriptions,
    awaitingReview,
    corpus: await readCorpus(db),
    ...(await readSourceHealth(db)),
    appUrl: baseUrl
  };

  const composed = composeDigest(input);

  const recipients = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    // Not an error worth alerting — it is a deployment that has not
    // been finished. Reporting it in the response is enough, and the
    // body is returned so a manual run still shows the digest.
    return NextResponse.json({
      ok: false,
      reason: 'no_recipients',
      hint: 'ADMIN_EMAILS is not set; nobody would receive this.',
      ...composed
    });
  }

  const sent = await sendOpsDigest(recipients, composed.subject, composed.text);
  if (!sent) {
    console.error('[cron/daily-digest] send_failed');
    alertOps('cron.daily_digest_send_failed', { recipients: recipients.length });
  }

  return NextResponse.json({ ok: sent, quiet: composed.quiet, subject: composed.subject });
}

async function readCorpus(
  db: ReturnType<typeof supabaseService>
): Promise<Record<string, number> | null> {
  try {
    const { data, error } = await db.from('legal_developments').select('status');
    if (error) return null;
    return ((data ?? []) as { status: string }[]).reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
  } catch {
    return null;
  }
}

/**
 * Feed health, split into three different problems.
 *
 * A source that failed is broken. A source that has never been polled
 * has never been proven to work at all — which is the state four of
 * ours have been in since they were seeded, and the reason this digest
 * exists. And a source the watcher switched off is neither: it is a
 * jurisdiction we have quietly stopped watching.
 *
 * The third category exists because this function used to filter on
 * `enabled` and therefore could not see it. Italy's Garante was
 * auto-disabled on 21 September and vanished from the digest the next
 * morning; the report went on saying "7 feeds failing" while the true
 * number of regulators we were not watching was nine. An instrument that
 * only reports the failures still switched on is an instrument for
 * failures we have already understood.
 */
async function readSourceHealth(db: ReturnType<typeof supabaseService>): Promise<{
  brokenSources: { id: string; error: string | null }[] | null;
  neverPolledSources: string[] | null;
  disabledSources: { id: string; reason: string | null }[] | null;
}> {
  const unavailable = {
    brokenSources: null,
    neverPolledSources: null,
    disabledSources: null
  };

  try {
    // Every source, not only the enabled ones. The filter is applied below,
    // where the three buckets are separated, rather than in the query where
    // it silently removed a whole category.
    const { data, error } = await db
      .from('legal_sources')
      .select('id, enabled, last_status, last_error, disabled_reason');
    if (error) return unavailable;

    const rows = (data ?? []) as {
      id: string;
      enabled: boolean;
      last_status: string | null;
      last_error: string | null;
      disabled_reason: string | null;
    }[];

    // Each source appears in exactly one bucket: a disabled source is not
    // also reported as failing, or the list doubles and stops being read.
    const live = rows.filter((r) => r.enabled);

    return {
      brokenSources: live
        .filter((r) => r.last_status === 'error')
        .map((r) => ({ id: r.id, error: r.last_error })),
      neverPolledSources: live.filter((r) => r.last_status === null).map((r) => r.id),
      disabledSources: rows
        .filter((r) => !r.enabled)
        .map((r) => ({ id: r.id, reason: r.disabled_reason }))
    };
  } catch {
    return unavailable;
  }
}
