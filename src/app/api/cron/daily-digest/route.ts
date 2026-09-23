import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { alertOps } from '@/lib/alert';
import { isCronAuthorized } from '@/lib/cron-auth';
import { composeDigest, type DigestInput } from '@/lib/daily-digest';
import { sendOpsDigest } from '@/lib/email';
import { stripe } from '@/lib/stripe';
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
        .from('legal_developments')
        .select('id', { head: true, count: 'exact' })
        .eq('status', 'extracted')
    )
  ]);

  const billing = await readBilling(db);

  const input: DigestInput = {
    auditsCompleted,
    auditsFailed,
    auditsStuck,
    creditsConsumed,
    newOrganizations,
    awaitingReview,
    ...billing,
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

/**
 * How many organisations are actually paying, asked of Stripe.
 *
 * WHY NOT OUR OWN TABLE, WHICH IS RIGHT THERE
 *
 * Because it was wrong, in the direction that flatters us, for four
 * months. The digest counted rows in `subscriptions` with an active-ish
 * status and printed "Active subscriptions 4". The four rows were one
 * organisation named "Test", holding four Stripe subscription ids created
 * on 14 and 15 May — starter, starter, pro and enterprise — every one of
 * them "active", every one with a null period end. No organisation can be
 * on three plans at once. The subscriptions had gone from Stripe and
 * nothing had told our table, because a mirror written by webhooks only
 * ever hears what it is sent.
 *
 * That number is the one line in the report that answers whether there is
 * a business. It has to come from the system of record.
 *
 * The mirror is still read, and a disagreement is reported as an action
 * rather than quietly corrected: the application grants access from the
 * mirror, so a gap is either a customer with the wrong entitlement or a
 * webhook we never received, and both need a person.
 */
async function readBilling(db: ReturnType<typeof supabaseService>): Promise<{
  activeSubscriptions: number | null;
  billingMirrorDrift: { stripe: number; mirror: number } | null;
}> {
  const mirror = await readMirrorSubscriptions(db);
  const fromStripe = await countStripeSubscriptions();

  return {
    activeSubscriptions: fromStripe,
    // A disagreement we could not measure is not a disagreement we may
    // report. Either side unreadable means no claim.
    billingMirrorDrift:
      fromStripe !== null && mirror !== null && fromStripe !== mirror
        ? { stripe: fromStripe, mirror }
        : null
  };
}

/** Distinct organisations our own table believes are subscribed. */
async function readMirrorSubscriptions(
  db: ReturnType<typeof supabaseService>
): Promise<number | null> {
  try {
    const { data, error } = await db
      .from('subscriptions')
      .select('organization_id')
      .in('status', ['active', 'trialing', 'past_due']);
    if (error) return null;
    // Organisations, not rows. Counting rows is what turned one test
    // account into four customers.
    return new Set((data ?? []).map((r) => (r as { organization_id: string }).organization_id)).size;
  } catch {
    return null;
  }
}

/**
 * Subscriptions Stripe itself calls live, counted by customer.
 *
 * Bounded pagination rather than auto-pagination: this runs in a cron with
 * a fixed budget, and a number we stopped counting half way through is a
 * wrong number. Past the ceiling it returns null — "unavailable" is a
 * state this digest already knows how to print, and it is the honest one.
 */
async function countStripeSubscriptions(): Promise<number | null> {
  const LIVE: Stripe.SubscriptionListParams.Status[] = ['active', 'trialing', 'past_due'];
  const PAGE = 100;
  const MAX_PAGES = 5;

  try {
    const customers = new Set<string>();

    for (const status of LIVE) {
      let startingAfter: string | undefined;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const batch: Stripe.ApiList<Stripe.Subscription> = await stripe().subscriptions.list({
          status,
          limit: PAGE,
          ...(startingAfter ? { starting_after: startingAfter } : {})
        });

        for (const sub of batch.data) {
          customers.add(typeof sub.customer === 'string' ? sub.customer : sub.customer.id);
        }

        if (!batch.has_more) break;
        if (page === MAX_PAGES - 1) return null;
        startingAfter = batch.data[batch.data.length - 1]?.id;
        if (!startingAfter) break;
      }
    }

    return customers.size;
  } catch (err) {
    // A missing key, a network failure, a Stripe outage. Every one of them
    // means we do not know, and do not know is not zero.
    console.error('[cron/daily-digest] stripe_unreadable', {
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}
