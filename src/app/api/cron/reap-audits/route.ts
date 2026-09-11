import { NextResponse } from 'next/server';
import { alertOps } from '@/lib/alert';
import { supabaseService } from '@/lib/supabase';

/**
 * Fail audits that stopped running and never said so.
 *
 * Every failure the audit route knows about refunds the credit and
 * records a reason. The failures it cannot know about are the ones
 * where the invocation itself disappears — platform eviction, an OOM, a
 * deploy landing mid-audit, a function killed at its duration limit.
 * By definition the code that would have cleaned up is the code that
 * just died, so the cleanup has to come from outside. On 10 Sep an
 * audit vanished exactly that way: a credit spent, no audit row, no
 * error, nothing to point at.
 *
 * This is deliberately installed before it is strictly needed. Today
 * the audit row is written only after the model work finishes, so a
 * killed invocation leaves nothing to sweep. The async pipeline changes
 * that — it opens the row as `running` up front — and the moment it
 * lands, every interrupted audit becomes a row stuck in `running`
 * forever. The net belongs under the trapeze before anyone climbs it.
 *
 * Triggered by Vercel Cron (see vercel.json), authenticated with
 * CRON_SECRET exactly like the other cron routes.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * How long an audit may legitimately stay unfinished.
 *
 * The audit function's own ceiling is 800s, and pass 1 may retry once
 * inside that, so nothing healthy can still be running after ~13
 * minutes. 20 gives clear daylight between "slow" and "dead" — a sweep
 * that reaps a live audit is worse than one that reaps a dead one
 * slightly late.
 */
const STUCK_AFTER_MINUTES = 20;

interface StuckAudit {
  id: string;
  organization_id: string;
  credit_consumed: boolean;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return reapAudits();
}

/** POST is also accepted because some queue systems prefer it. */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return reapAudits();
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return process.env.NODE_ENV !== 'production';
  }
  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${expected}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get('secret') === expected;
}

async function reapAudits() {
  const db = supabaseService();
  const cutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000).toISOString();

  // The status guard is what makes this safe to run every minute and
  // safe to race against the audit itself: whichever of the two writes
  // first moves the row out of `running`, and the other matches nothing.
  // A credit can therefore never be refunded twice.
  const { data, error } = await db
    .from('audits')
    .update({
      status: 'failed',
      error_message: `reaped: never finished, still unfinished after ${STUCK_AFTER_MINUTES} minutes`
    })
    .in('status', ['running', 'pending'])
    .lt('created_at', cutoff)
    .select('id, organization_id, credit_consumed');

  if (error) {
    console.error('[cron/reap-audits] sweep_failed', { error: error.message });
    alertOps('cron.reap_audits_failed', { error: error.message });
    return NextResponse.json({ error: 'sweep_failed', detail: error.message }, { status: 500 });
  }

  const reaped = (data ?? []) as StuckAudit[];
  let refunded = 0;
  const refundFailures: string[] = [];

  for (const audit of reaped) {
    if (!audit.credit_consumed) continue;
    const { error: refundErr } = await db.rpc('refund_audit_credit', {
      p_org_id: audit.organization_id
    });
    if (refundErr) {
      // The audit is already marked failed, so the customer is not left
      // waiting — but they are now down a credit for work they never
      // received, which is exactly the thing this route exists to stop.
      refundFailures.push(audit.id);
      console.error('[cron/reap-audits] refund_failed', {
        auditId: audit.id,
        error: refundErr.message
      });
    } else {
      refunded += 1;
    }
  }

  if (reaped.length > 0) {
    console.warn('[cron/reap-audits] reaped', { count: reaped.length, refunded });
    // An audit only lands here because an invocation died without a
    // trace. One is worth knowing about; a pattern is worth acting on.
    alertOps('cron.audits_reaped', {
      count: reaped.length,
      refunded,
      refundFailures,
      auditIds: reaped.map((a) => a.id)
    });
  }

  return NextResponse.json({
    ok: true,
    stuckAfterMinutes: STUCK_AFTER_MINUTES,
    reaped: reaped.length,
    refunded,
    refundFailures
  });
}
