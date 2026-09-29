import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { alertOps } from '@/lib/alert';
import { isCronAuthorized } from '@/lib/cron-auth';
import { capturePolicy } from '@/lib/policy-capture';
import { discoverPolicy, type Candidate } from '@/lib/policy-discovery';
import { observePolicy } from '@/lib/policy-observations';
import { supabaseService } from '@/lib/supabase';
import { fetchFrenchSample } from '@/lib/survey-sample';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The observatory: what French sites actually publish in their privacy
 * policies, counted.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The site has 330 programmatic pages and Google indexes five of them.
 * The diagnosis is not the content, it is that a new domain with no
 * inbound link does not get crawled, and programmatic pages never earn
 * one — nobody cites a generated page. What earns a link is a number
 * nobody else has, published with a method somebody can check.
 *
 * We are unusually placed to produce one. The machinery already exists
 * and is already careful: a crawler that obeys robots.txt, a capture step
 * that refuses a document it did not really read, seven observations that
 * are findings rather than opinions, and verifySpan, which will not let a
 * quotation through unless it is literally in the page.
 *
 * WHAT IT PUBLISHES, AND WHAT IT WILL NOT
 *
 * Aggregates. "38% state a retention period" is a fact about a population
 * and breaks no rule. "example.fr is non-compliant" is an accusation, it
 * is defamatory if wrong, and it is not what an observation means — a
 * `not_found` says our reader did not find a thing in one document on one
 * day, which is a statement about our reading. Per-domain results stay
 * behind the DNS verification that already gates them.
 *
 * REFUSALS ARE PART OF THE RESULT
 *
 * Every domain that answered 403, dropped the connection, disallowed us
 * in robots.txt or served a page built in the browser is counted and
 * named as such. A study that silently drops what it could not read
 * reports a denominator it made up, and the refusal rate is one of the
 * more interesting numbers here anyway.
 *
 * DELIBERATELY SLOW
 *
 * A handful of domains per run, sequentially, each one a single fetch of
 * a homepage and a policy. These are other people's servers and we are
 * not entitled to be in a hurry. The sample fills over weeks, and the
 * page says how far along it is rather than publishing a third of a
 * study as if it were whole.
 */

/** How many .fr domains the study covers. */
const SAMPLE_SIZE = 300;

/** Domains looked at per run. Politeness, not throughput. */
const DOMAINS_PER_RUN = 12;

/**
 * How long a reading stands before we look again.
 *
 * A privacy policy is not a news feed. Re-reading the same document every
 * week would cost the site traffic and tell us nothing, and it would let
 * the study's figures drift under a reader who cited them last month.
 */
const RESCAN_AFTER_DAYS = 90;

export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return survey();
}

export async function POST(request: Request) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return survey();
}

async function survey() {
  const db = supabaseService();

  const seeded = await seedSampleIfEmpty(db);
  if (seeded.refused) {
    // No sample, no study — and SAID, not returned.
    //
    // This ran eight times a day for two days and produced nothing,
    // because the reason travelled in the HTTP response body and a cron's
    // response goes nowhere. The observatory sat at zero domains while
    // every instrument reported a healthy run. That is the failure this
    // whole codebase is built against, committed in the route written to
    // embody it.
    console.error('[cron/policy-survey] no_sample', { reason: seeded.refused });
    alertOps('cron.policy_survey_no_sample', { reason: seeded.refused });
    return NextResponse.json({ ok: false, reason: seeded.refused }, { status: 200 });
  }

  const { data: pending, error } = await db.rpc('survey_next_domains', {
    p_limit: DOMAINS_PER_RUN,
    p_stale_before: new Date(Date.now() - RESCAN_AFTER_DAYS * 86_400_000).toISOString()
  });

  if (error) {
    console.error('[cron/policy-survey] queue_unreadable', { error: error.message });
    return NextResponse.json({ error: 'queue_unreadable', detail: error.message }, { status: 500 });
  }

  const domains = ((pending ?? []) as { domain: string }[]).map((row) => row.domain);
  const stats = { looked_at: 0, observed: 0, refused: 0 };

  for (const domain of domains) {
    try {
      const outcome = await surveyOne(db, domain);
      stats.looked_at += 1;
      if (outcome === 'done') stats.observed += 1;
      else stats.refused += 1;
    } catch (err) {
      // One unreachable site must not cost us the other eleven.
      console.error('[cron/policy-survey] domain_threw', {
        domain,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  // A run that reaches no domain is not a quiet run: either the sample is
  // exhausted — which is the study finishing, and worth knowing — or the
  // queue query is returning nothing when it should not.
  if (domains.length === 0) {
    const { count } = await db
      .from('scans')
      .select('id', { head: true, count: 'exact' })
      .eq('origin', 'survey')
      .not('completed_at', 'is', null);
    console.log('[cron/policy-survey] nothing_pending', { completed: count ?? 0 });
  }

  console.log('[cron/policy-survey] run complete', stats);
  return NextResponse.json({ ok: true, ...stats, seeded: seeded.added });
}

/**
 * Read one domain, through the same pipeline the public tool uses.
 *
 * Identical on purpose. A separate code path would drift, and a study
 * computed from a drifted copy of the product is a study about something
 * we do not sell. The only difference is the row's `origin`.
 */
async function surveyOne(
  db: ReturnType<typeof supabaseService>,
  domain: string
): Promise<'done' | 'failed'> {
  const token = randomBytes(18).toString('base64url');

  const { data: scan, error } = await db
    .from('scans')
    .insert({ token, domain, locale: 'fr', status: 'running', origin: 'survey' })
    .select('id')
    .single();

  if (error || !scan) throw new Error(error?.message ?? 'could not open a scan row');

  const finish = async (patch: Record<string, unknown>) => {
    await db
      .from('scans')
      .update({ completed_at: new Date().toISOString(), ...patch })
      .eq('id', scan.id);
  };

  const discovery = await discoverPolicy(domain);
  if (discovery.refused || discovery.candidates.length === 0) {
    await finish({ status: 'failed', failure: discovery.refused ?? 'no candidate' });
    return 'failed';
  }

  let captured: Awaited<ReturnType<typeof capturePolicy>>['capture'] = null;
  let candidate: Candidate | null = null;
  let lastRefusal = 'no candidate could be read';

  for (const option of discovery.candidates.slice(0, 3)) {
    const attempt = await capturePolicy(option.url);
    if (attempt.capture) {
      captured = attempt.capture;
      candidate = option;
      break;
    }
    lastRefusal = attempt.refused ?? lastRefusal;
  }

  if (!captured || !candidate) {
    await finish({ status: 'failed', failure: lastRefusal });
    return 'failed';
  }

  const { data: snapshot, error: snapshotError } = await db
    .from('scan_snapshots')
    .insert({
      scan_id: scan.id,
      url: captured.url,
      provenance: candidate.provenance,
      content_hash: captured.contentHash,
      content_type: captured.contentType,
      byte_length: captured.byteLength,
      text_length: captured.text.length,
      fetched_at: captured.fetchedAt
    })
    .select('id')
    .single();

  if (snapshotError || !snapshot) {
    await finish({ status: 'failed', failure: 'could not record the document' });
    return 'failed';
  }

  const observations = observePolicy(captured.text);

  // The same guard as the public scan, and for the same reason: seven
  // blanks is far more likely to be our failure than the document's
  // content, and seven blanks counted into a statistic would be a
  // fabricated data point rather than a published one.
  if (!observations.some((o) => o.finding === 'present')) {
    await finish({
      status: 'failed',
      failure:
        'read a page, but none of the seven observations could be established — it does not look like a privacy policy'
    });
    return 'failed';
  }

  await db.from('scan_observations').insert(
    observations.map((o) => ({
      snapshot_id: snapshot.id,
      observation: o.id,
      finding: o.finding,
      evidence: o.evidence ?? null
    }))
  );

  await finish({ status: 'done', failure: null });
  return 'done';
}

/**
 * Fill the sample once, from a ranking that identifies itself.
 *
 * Only when empty. Re-seeding on every run would silently move the
 * population under a published figure — someone citing "300 .fr domains,
 * Tranco list X" would find the number had been computed over a
 * different set. Refreshing the sample is a deliberate act with a new
 * list id, not a side effect of a cron.
 */
async function seedSampleIfEmpty(
  db: ReturnType<typeof supabaseService>
): Promise<{ added: number; refused: string | null }> {
  const { count, error } = await db
    .from('survey_domains')
    .select('domain', { head: true, count: 'exact' });

  if (error) return { added: 0, refused: `could not read the sample: ${error.message}` };
  if ((count ?? 0) > 0) return { added: 0, refused: null };

  const sample = await fetchFrenchSample(SAMPLE_SIZE);
  if (sample.refused) return { added: 0, refused: sample.refused };

  const { error: insertError } = await db.from('survey_domains').insert(
    sample.entries.map((entry) => ({
      domain: entry.domain,
      rank: entry.rank,
      source: 'tranco',
      source_id: sample.sourceId,
      source_date: sample.sourceDate
    }))
  );

  if (insertError) return { added: 0, refused: `could not store the sample: ${insertError.message}` };

  console.log('[cron/policy-survey] sample_seeded', {
    domains: sample.entries.length,
    sourceId: sample.sourceId,
    sourceDate: sample.sourceDate
  });
  return { added: sample.entries.length, refused: null };
}
