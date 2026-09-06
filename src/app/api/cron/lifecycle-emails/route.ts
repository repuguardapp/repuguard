import { NextResponse } from 'next/server';
import { sendLifecycleNudge, sendLifecycleUpgrade } from '@/lib/email';
import { supabaseService } from '@/lib/supabase';

/**
 * Daily lifecycle-email cron. Two conditional stages:
 *
 *   J+3 nudge   → org signed up 3+ days ago, welcome was sent, but
 *                 no audit has ever been submitted from that org.
 *   J+14 upgrade→ org has at least one audit but no active/trialing
 *                 subscription, and 14+ days have passed since signup.
 *
 * Idempotence is enforced by three timestamp columns on the
 * organizations table (see migration 0012). Each column is set only
 * when Resend accepted the send, so a failed send retries on the
 * next tick — no manual replay required.
 *
 * Auth: Bearer CRON_SECRET (same pattern as /api/cron/purge).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NUDGE_MIN_DAYS = 3;
const UPGRADE_MIN_DAYS = 14;
// Per-tick cap so a bad day (Resend outage clearing) doesn't melt
// the sending domain reputation with a burst of 500 emails at once.
const BATCH_LIMIT = 100;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get('secret') === secret;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return run();
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return run();
}

async function run() {
  const db = supabaseService();
  const now = Date.now();
  const nudgeCutoff = new Date(now - NUDGE_MIN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const upgradeCutoff = new Date(now - UPGRADE_MIN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const stats = { nudge_sent: 0, upgrade_sent: 0, nudge_skipped: 0, upgrade_skipped: 0 };

  // ---- J+3 nudge ----------------------------------------------------
  const { data: nudgeCandidates } = await db
    .from('organizations')
    .select('id, created_at')
    .lt('created_at', nudgeCutoff)
    .is('lifecycle_nudge_sent_at', null)
    .not('id', 'eq', '00000000-0000-0000-0000-000000000000')
    .limit(BATCH_LIMIT);

  for (const org of nudgeCandidates ?? []) {
    // Skip if the org has already submitted at least one audit —
    // the nudge is only for tyre-kickers who signed up and vanished.
    const { count } = await db
      .from('audits')
      .select('id', { head: true, count: 'exact' })
      .eq('organization_id', org.id)
      .limit(1);
    if ((count ?? 0) > 0) {
      // Mark as "sent" (semantically: no longer eligible) so we
      // don't re-check this org every day for the rest of its life.
      await db.from('organizations').update({ lifecycle_nudge_sent_at: new Date().toISOString() }).eq('id', org.id);
      stats.nudge_skipped++;
      continue;
    }
    const email = await ownerEmail(org.id);
    if (!email) { stats.nudge_skipped++; continue; }
    const sent = await sendLifecycleNudge(email);
    if (sent) {
      await db.from('organizations').update({ lifecycle_nudge_sent_at: new Date().toISOString() }).eq('id', org.id);
      stats.nudge_sent++;
    }
  }

  // ---- J+14 upgrade -------------------------------------------------
  const { data: upgradeCandidates } = await db
    .from('organizations')
    .select('id, created_at')
    .lt('created_at', upgradeCutoff)
    .is('lifecycle_upgrade_sent_at', null)
    .not('id', 'eq', '00000000-0000-0000-0000-000000000000')
    .limit(BATCH_LIMIT);

  for (const org of upgradeCandidates ?? []) {
    // Only nudge orgs that used the product (have at least 1 audit)
    // AND aren't paying yet. Sending to non-users is spam; sending
    // to paying customers is embarrassing.
    const { count: auditCount } = await db
      .from('audits')
      .select('id', { head: true, count: 'exact' })
      .eq('organization_id', org.id)
      .limit(1);
    const { data: sub } = await db
      .from('subscriptions')
      .select('status')
      .eq('organization_id', org.id)
      .in('status', ['active', 'trialing', 'past_due'])
      .maybeSingle();
    if ((auditCount ?? 0) === 0 || sub) {
      await db.from('organizations').update({ lifecycle_upgrade_sent_at: new Date().toISOString() }).eq('id', org.id);
      stats.upgrade_skipped++;
      continue;
    }
    const email = await ownerEmail(org.id);
    if (!email) { stats.upgrade_skipped++; continue; }
    const sent = await sendLifecycleUpgrade(email);
    if (sent) {
      await db.from('organizations').update({ lifecycle_upgrade_sent_at: new Date().toISOString() }).eq('id', org.id);
      stats.upgrade_sent++;
    }
  }

  console.log('[cron/lifecycle-emails] run complete', stats);
  return NextResponse.json({ ok: true, ...stats });
}

/**
 * Resolve the first authenticated user whose app_metadata carries
 * this organization id, and return their email. Slow-ish (paginated
 * list of all users), but the org table is small and this cron runs
 * once a day. Good enough until we outgrow it.
 */
async function ownerEmail(organizationId: string): Promise<string | null> {
  const admin = supabaseService();
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = (data?.users ?? []).find(
    (u) => (u.app_metadata as { organization_id?: string } | null)?.organization_id === organizationId
  );
  return user?.email ?? null;
}
