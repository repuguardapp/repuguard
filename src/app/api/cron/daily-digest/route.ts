import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { alertOps } from '@/lib/alert';
import { isCronAuthorized } from '@/lib/cron-auth';
import { composeDigest, type DigestInput, type RejectionDigest } from '@/lib/daily-digest';
import { sendOpsDigest } from '@/lib/email';
import { stripe } from '@/lib/stripe';
import { latestCiRun } from '@/lib/ci-status';
import { FUNNEL_STAGES, type Funnel, type FunnelWindow } from '@/lib/funnel';
import { OUTREACH_SENT_AT, outreachTest } from '@/lib/outreach-test';
import { isRuleWritten } from '@/lib/rejection-reasons';
import { listReferrals } from '@/lib/referrals';
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

  // Read once and used twice: the standing subscription count and the
  // funnel's paid stage are the same facts windowed differently, and a
  // second round of Stripe pagination inside a 60s cron is how a figure
  // becomes "unavailable" for no reason but our own structure.
  const liveSubscriptions = await readStripeLiveSubscriptions();
  const billing = readBillingFrom(await readMirrorSubscriptions(db), liveSubscriptions);

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
    barrenSources: await readBarrenSources(db),
    stalledItems: await readStalledItems(db),
    parkedItems: await readParkedItems(db),
    ci: await latestCiRun(),
    // listReferrals returns null when the read failed, and outreachTest
    // passes that null straight through — so a database error reports
    // itself as unreadable rather than as "nobody linked to us", which
    // is the sentence that retires a channel.
    outreach: outreachTest(await listReferrals()),
    rejections: await readRejections(db, since),
    funnel: await readFunnel(db, since, liveSubscriptions),
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
function readBillingFrom(
  mirror: number | null,
  live: StripeLiveSubscription[] | null
): {
  activeSubscriptions: number | null;
  billingMirrorDrift: { stripe: number; mirror: number } | null;
} {
  // Customers, not rows. Counting rows is what turned one test account
  // into four customers for four months.
  const fromStripe = live === null ? null : new Set(live.map((s) => s.customer)).size;

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
 * One live subscription, with the moment it started.
 *
 * `created` is carried because the funnel needs the paid stage placed in
 * a window, and Stripe is the only place that timestamp is trustworthy —
 * our mirror had four phantom rows with null period ends for four
 * months.
 */
interface StripeLiveSubscription {
  customer: string;
  /** Unix seconds, as Stripe gives it. */
  created: number;
}

/**
 * Subscriptions Stripe itself calls live.
 *
 * Bounded pagination rather than auto-pagination: this runs in a cron with
 * a fixed budget, and a number we stopped counting half way through is a
 * wrong number. Past the ceiling it returns null — "unavailable" is a
 * state this digest already knows how to print, and it is the honest one.
 */
async function readStripeLiveSubscriptions(): Promise<StripeLiveSubscription[] | null> {
  const LIVE: Stripe.SubscriptionListParams.Status[] = ['active', 'trialing', 'past_due'];
  const PAGE = 100;
  const MAX_PAGES = 5;

  try {
    const found: StripeLiveSubscription[] = [];

    for (const status of LIVE) {
      let startingAfter: string | undefined;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const batch: Stripe.ApiList<Stripe.Subscription> = await stripe().subscriptions.list({
          status,
          limit: PAGE,
          ...(startingAfter ? { starting_after: startingAfter } : {})
        });

        for (const sub of batch.data) {
          found.push({
            customer: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
            created: sub.created
          });
        }

        if (!batch.has_more) break;
        if (page === MAX_PAGES - 1) return null;
        startingAfter = batch.data[batch.data.length - 1]?.id;
        if (!startingAfter) break;
      }
    }

    return found;
  } catch (err) {
    // A missing key, a network failure, a Stripe outage. Every one of them
    // means we do not know, and do not know is not zero.
    console.error('[cron/daily-digest] stripe_unreadable', {
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}

/**
 * Sources that poll cleanly and have never produced a usable item.
 *
 * The question the console could not answer, because it was answering a
 * different one. `last_status = ok` means items were ingested; it says
 * nothing about whether any survived extraction. ADGM has reported "ok,
 * 60" every six hours while all 45 of its classified items were rejected.
 *
 * Read from legal_developments rather than from a counter on the source
 * row, so it cannot drift from the corpus it describes. `discovered` is
 * excluded from the denominator: an item still queued for extraction has
 * not been judged, and counting it as a failure would accuse a source of
 * barrenness for being recent.
 */
const BARREN_MIN_CLASSIFIED = 8;

async function readBarrenSources(
  db: ReturnType<typeof supabaseService>
): Promise<{ id: string; rejected: number }[] | null> {
  try {
    const { data, error } = await db
      .from('legal_developments')
      .select('source_id, status')
      .neq('status', 'discovered')
      .limit(20_000);
    if (error) return null;

    const tally = new Map<string, { kept: number; rejected: number }>();
    for (const row of (data ?? []) as { source_id: string; status: string }[]) {
      const entry = tally.get(row.source_id) ?? { kept: 0, rejected: 0 };
      if (row.status === 'rejected') entry.rejected += 1;
      else entry.kept += 1;
      tally.set(row.source_id, entry);
    }

    return [...tally.entries()]
      // A sample worth believing. Three rejections in a row is a quiet
      // fortnight at a regulator, not a verdict on the source.
      .filter(([, t]) => t.kept === 0 && t.rejected >= BARREN_MIN_CLASSIFIED)
      .map(([id, t]) => ({ id, rejected: t.rejected }))
      .sort((a, b) => b.rejected - a.rejected);
  } catch {
    return null;
  }
}

/**
 * What a rule deleted, by name, in the last day.
 *
 * A rejection with a reason reads like the system working, and that is
 * exactly how a £190,000 ICO penalty against Elderly Aids Limited left
 * the corpus on 20 September: the dedup rule matched two documents on
 * two absent amounts, rejected the penalty notice as a duplicate of the
 * enforcement notice, and wrote a sentence explaining itself. Nobody
 * looked for a month.
 *
 * That specific bug is fixed. The shape is not: two rules now delete
 * rows without a human, they have removed 37 items in thirty days, and
 * the only surface that mentions any of it is a cumulative
 * `rejected 207` in this very report — a number that cannot tell a
 * recruitment notice from a sanction.
 *
 * SO THE MACHINE'S DELETIONS ARE NAMED AND THE MODEL'S ARE COUNTED
 *
 * The model rejecting a press release as off-topic is the filter doing
 * its job, four times a day, and listing those would bury the line that
 * matters. A rule removing a decision somebody else published is a
 * different act: roughly one a day, small enough to read, and the only
 * way to notice the day it takes something real.
 */
const MAX_NAMED_REJECTIONS = 8;

async function readRejections(
  db: ReturnType<typeof supabaseService>,
  since: string
): Promise<RejectionDigest | null> {
  try {
    const { data, error } = await db
      .from('legal_developments')
      .select('raw_title, primary_url, rejected_reason, summary_en, updated_at')
      .eq('status', 'rejected')
      .gte('updated_at', since)
      .limit(500);
    if (error) return null;

    const rows = (data ?? []) as {
      raw_title: string;
      primary_url: string;
      rejected_reason: string | null;
      summary_en: string | null;
    }[];

    const byRule: RejectionDigest['byRule'] = [];
    let byModel = 0;
    let byHuman = 0;

    for (const row of rows) {
      const reason = row.rejected_reason ?? '';
      /**
       * Read from the shared list rather than from literals copied in
       * here. Two were copied, a third rule was added the same day, and
       * nothing would have failed: its deletions would simply have been
       * filed as "off topic" and never named again. A rule that removes
       * decisions without a human and reports itself as routine noise is
       * the failure this whole block exists to catch.
       */
      if (isRuleWritten(reason)) {
        byRule.push({ title: row.raw_title, reason, url: row.primary_url });
      } else if (row.summary_en) {
        // It had been extracted, so a human saw it in the queue and
        // rejected it there. The model never gets that far.
        byHuman += 1;
      } else {
        byModel += 1;
      }
    }

    return {
      byRule: byRule.slice(0, MAX_NAMED_REJECTIONS),
      ruleOverflow: Math.max(0, byRule.length - MAX_NAMED_REJECTIONS),
      byModel,
      byHuman
    };
  } catch {
    return null;
  }
}

/**
 * How long has the extraction pass been stuck?
 *
 * `discovered` is a transit state: the watcher writes it and the
 * extractor empties it within hours. An item sitting there for a day is
 * not a backlog, it is a stopped pipeline — and the difference is
 * invisible in a corpus count, which shows the same number whether the
 * queue is draining or frozen.
 *
 * The threshold is generous on purpose. The extractor runs every six
 * hours and takes eight items, so a genuine burst from a regulator can
 * legitimately wait most of a day before its turn.
 */
const STALLED_AFTER_HOURS = 30;

/**
 * Items the extractor has given up on, grouped by what it said.
 *
 * Grouped rather than listed because the interesting fact is almost
 * never which development failed — it is that five of them failed the
 * same way, which is the shape of a bug in our extractor rather than
 * five awkward regulator pages. The two items that created this state
 * both failed on `evidence.fine_eur: null`; printed as two separate
 * incidents they looked like the source's fault, and printed as "2× …"
 * they are obviously one line of our own code.
 */
async function readParkedItems(
  db: ReturnType<typeof supabaseService>
): Promise<{ count: number; reasons: { error: string; count: number }[] } | null> {
  try {
    const { data, error } = await db
      .from('legal_developments')
      .select('extract_error')
      .eq('status', 'extract_failed')
      .limit(500);

    if (error) return null;

    const rows = (data ?? []) as { extract_error: string | null }[];
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = row.extract_error ?? 'no reason was recorded';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return {
      count: rows.length,
      reasons: [...counts.entries()]
        .map(([err, count]) => ({ error: err, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
    };
  } catch {
    return null;
  }
}

async function readStalledItems(
  db: ReturnType<typeof supabaseService>
): Promise<{ count: number; oldestHours: number } | null> {
  try {
    const cutoff = new Date(Date.now() - STALLED_AFTER_HOURS * 3_600_000).toISOString();

    const { data, error } = await db
      .from('legal_developments')
      .select('created_at')
      .eq('status', 'discovered')
      .lt('created_at', cutoff)
      .order('created_at')
      .limit(5000);

    if (error) return null;

    const rows = (data ?? []) as { created_at: string }[];
    if (rows.length === 0) return { count: 0, oldestHours: 0 };

    const oldest = new Date(rows[0]!.created_at).getTime();
    return {
      count: rows.length,
      oldestHours: Math.round((Date.now() - oldest) / 3_600_000)
    };
  } catch {
    return null;
  }
}

/**
 * Where a visitor stops, by stage and by window.
 *
 * THE FILTER THAT MAKES THIS NOT A LIE
 *
 * `scans` holds 309 rows and only 12 of them are people: the other 297
 * have `origin = 'survey'` and are the observatory's own crawl of .fr
 * domains, run by us, against strangers' sites, for the ranking study.
 * Counting the table would have reported 309 visitors in a funnel whose
 * true entry count is twelve, all twelve from one afternoon in
 * September, all of them the operator testing his own product. That is
 * precisely the shape of wrong number this report exists to prevent, and
 * it was one missing WHERE clause away.
 *
 * WHY THERE ARE THREE READS AND NOT FIFTEEN COUNTS
 *
 * Each stage is read once with its timestamps and the three windows are
 * derived in memory. The tables are small — 12, 6 and 3 rows — and
 * fifteen `head: true` counts in a 60-second cron is fourteen more
 * chances for one window to come back unreadable while its neighbours
 * look fine, which would print a funnel with a hole in the middle.
 *
 * A read that hits its row ceiling returns null rather than a count.
 * A truncated count is not a small count, and this is the one block in
 * the digest whose zeros are supposed to be believed.
 */
const FUNNEL_ROW_CEILING = 20_000;

/** Timestamps for one stage, or null when the read failed or truncated. */
async function readStageTimes(
  db: ReturnType<typeof supabaseService>,
  build: () => PromiseLike<{ data: unknown; error: unknown }>
): Promise<number[] | null> {
  try {
    const { data, error } = await build();
    if (error) return null;
    const rows = (data ?? []) as { created_at: string }[];
    if (rows.length >= FUNNEL_ROW_CEILING) return null;
    return rows.map((r) => Date.parse(r.created_at)).filter((t) => Number.isFinite(t));
  } catch {
    return null;
  }
}

/**
 * Public scans with the one bit the funnel needs from each.
 *
 * `done` rather than "not failed": a scan that found no policy now
 * renders its own Art. 12(1) result card, which is a legitimate answer,
 * but it is not somebody seeing their own document assessed. Counting it
 * as progress would make last week's repair look like a conversion.
 */
async function readScans(
  db: ReturnType<typeof supabaseService>
): Promise<{ at: number; done: boolean }[] | null> {
  try {
    const { data, error } = await db
      .from('scans')
      .select('created_at, status')
      .eq('origin', 'public')
      .limit(FUNNEL_ROW_CEILING);
    if (error) return null;
    const rows = (data ?? []) as { created_at: string; status: string }[];
    if (rows.length >= FUNNEL_ROW_CEILING) return null;
    return rows
      .map((r) => ({ at: Date.parse(r.created_at), done: r.status === 'done' }))
      .filter((r) => Number.isFinite(r.at));
  } catch {
    return null;
  }
}

async function readFunnel(
  db: ReturnType<typeof supabaseService>,
  since: string,
  liveSubscriptions: StripeLiveSubscription[] | null
): Promise<Funnel | null> {
  const dayFrom = Date.parse(since);
  const outreachFrom = Date.parse(OUTREACH_SENT_AT);

  // `origin = 'public'` is the whole difference between a funnel and the
  // survey crawl. See the comment above this function.
  //
  // One query, split in memory, so "asked" and "read" can never be taken
  // from two different moments — two queries a second apart can report
  // more scans read than asked, and a funnel that widens is a funnel
  // nobody will believe again.
  const scans = await readScans(db);
  const scanAsked = scans === null ? null : scans.map((s) => s.at);
  const scanDone = scans === null ? null : scans.filter((s) => s.done).map((s) => s.at);

  const accounts = await readStageTimes(db, () =>
    db.from('organizations').select('created_at').limit(FUNNEL_ROW_CEILING)
  );

  const audits = await readStageTimes(db, () =>
    db.from('audits').select('created_at').limit(FUNNEL_ROW_CEILING)
  );

  // Stripe gives seconds; everything else here is milliseconds.
  const paid =
    liveSubscriptions === null ? null : liveSubscriptions.map((s) => s.created * 1000);

  const stages: Record<string, number[] | null> = {
    scanAsked,
    scanRead: scanDone,
    account: accounts,
    audit: audits,
    paid
  };

  const windowAt = (from: number | null): FunnelWindow =>
    Object.fromEntries(
      FUNNEL_STAGES.map((s) => {
        const times = stages[s.key];
        if (times === null || times === undefined) return [s.key, null];
        return [s.key, from === null ? times.length : times.filter((t) => t >= from).length];
      })
    ) as FunnelWindow;

  return {
    day: windowAt(Number.isFinite(dayFrom) ? dayFrom : null),
    sinceOutreach: windowAt(Number.isFinite(outreachFrom) ? outreachFrom : null),
    allTime: windowAt(null),
    outreachFrom: OUTREACH_SENT_AT.slice(0, 10)
  };
}
