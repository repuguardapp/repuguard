import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { alertOps } from '@/lib/alert';
import { isCronAuthorized } from '@/lib/cron-auth';
import { capturePolicy } from '@/lib/policy-capture';
import { discoverPolicy, type Candidate } from '@/lib/policy-discovery';
import { observePolicy } from '@/lib/policy-observations';
import { sendOpsDigest } from '@/lib/email';
import { observatoryCsv, observatoryReport } from '@/lib/observatory';
import { supabaseService } from '@/lib/supabase';
import { fetchFrenchSample } from '@/lib/survey-sample';
import { depositEditionOnce } from '@/lib/zenodo';

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

  /**
   * Write down what happened, whatever happened.
   *
   * legal_sources has had last_status and last_error since the poller was
   * written. The survey had nothing, so two days of producing no domains
   * were only discoverable by reading Vercel's logs. One row per run, in
   * the database, answerable with a query.
   */
  const record = async (row: {
    ok: boolean;
    reason?: string | null;
    seeded?: number;
    looked_at?: number;
    observed?: number;
    refused?: number;
  }) => {
    const { error } = await db.from('survey_runs').insert({
      ok: row.ok,
      reason: row.reason ?? null,
      seeded: row.seeded ?? 0,
      looked_at: row.looked_at ?? 0,
      observed: row.observed ?? 0,
      refused: row.refused ?? 0
    });
    if (error) console.error('[cron/policy-survey] run_not_recorded', { error: error.message });
  };

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
    await record({ ok: false, reason: seeded.refused });
    return NextResponse.json({ ok: false, reason: seeded.refused }, { status: 200 });
  }

  const { data: pending, error } = await db.rpc('survey_next_domains', {
    p_limit: DOMAINS_PER_RUN,
    p_stale_before: new Date(Date.now() - RESCAN_AFTER_DAYS * 86_400_000).toISOString()
  });

  if (error) {
    console.error('[cron/policy-survey] queue_unreadable', { error: error.message });
    alertOps('cron.policy_survey_queue_unreadable', { error: error.message });
    await record({ ok: false, reason: `queue unreadable: ${error.message}` });
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
  await record({
    ok: true,
    seeded: seeded.added,
    looked_at: stats.looked_at,
    observed: stats.observed,
    refused: stats.refused
  });

  const deposited = await depositIfFinished(db);

  return NextResponse.json({ ok: true, ...stats, seeded: seeded.added, ...deposited });
}

/**
 * When the edition finishes, deposit it. Once.
 *
 * This was the last manual act in the distribution chain. Everything
 * else fills itself and then somebody had to notice, on the right day,
 * that the sample had completed, and press a button on an admin page. A
 * step that depends on a human noticing a moment is a step that does not
 * happen — and the sixty-day test the whole observatory exists to settle
 * starts counting whether or not anyone pressed it.
 *
 * WHAT IS AUTOMATED IS THE DRAFT, NOT THE DOI
 *
 * A draft can be deleted. A minted DOI is permanent by design and cannot
 * be withdrawn, only superseded, and this pipeline has produced a wrong
 * morning often enough to make that distinction the whole design: seven
 * blank observations about Airbnb, a sitemap of 321 undated children read
 * as a silent regulator, a ministry newsroom ingested as a data
 * protection feed. The last click belongs to whoever has read the
 * numbers. That is one click per quarterly edition.
 *
 * NEVER BLOCKS THE RUN
 *
 * Wrapped whole. Zenodo being down, slow or unreachable must not cost us
 * the twelve domains this invocation just read — the crawl is the thing
 * with a schedule, and the deposit can wait three hours for the next run.
 */
async function depositIfFinished(
  db: ReturnType<typeof supabaseService>
): Promise<{ deposit?: string }> {
  try {
    const report = await observatoryReport();
    // Not "could not read the figures" — that is a different sentence and
    // it belongs to the module that discovered it, which already said so.
    if (!report) return {};
    if (report.pending > 0) return {};

    const result = await depositEditionOnce(db, report, observatoryCsv(report));

    // Already deposited: the normal state for every run after the first
    // one that completed the edition, and silent on purpose.
    if (result.skipped && !result.refused) return {};

    if (result.refused) {
      console.error('[cron/policy-survey] deposit_refused', { reason: result.refused });
      alertOps('cron.observatory_deposit_refused', { reason: result.refused });
      await emailOperator(
        'LexyFlow — le dépôt Zenodo a été refusé',
        [
          `L'édition ${report.sourceId ?? 'en cours'} est complète et le dépôt a échoué.`,
          '',
          result.refused,
          '',
          `${report.documentsRead} politiques lues sur ${report.lookedAt} domaines tentés.`,
          '',
          "Rien ne réessaiera tout seul : la ligne observatory_deposits garde l'édition",
          'réservée pour que trois heures de panne ne produisent pas huit tentatives.',
          'Dis-le-moi une fois la cause corrigée et je libère la réservation.'
        ].join('\n')
      );
      return { deposit: `refused: ${result.refused}` };
    }

    console.log('[cron/policy-survey] zenodo_draft_created', {
      depositionId: result.depositionId,
      doi: result.doi
    });
    // Alerted because it needs a human: the draft is complete and the
    // DOI is one deliberate click away, on a page nobody is watching.
    alertOps('cron.observatory_deposit_ready', {
      doi: result.doi,
      editUrl: result.editUrl,
      documentsRead: report.documentsRead,
      lookedAt: report.lookedAt
    });

    await emailOperator(
      'LexyFlow — le brouillon Zenodo attend ta publication',
      [
        `L'étude est complète : ${report.documentsRead} politiques lues sur ${report.lookedAt} domaines tentés,`,
        `échantillon de ${report.sampleSize}.`,
        '',
        result.doi ? `DOI réservé : ${result.doi}` : 'Aucun DOI réservé par Zenodo.',
        result.editUrl ? `Relire et publier : ${result.editUrl}` : '',
        '',
        "Un brouillon s'efface, un DOI jamais. Relis les sept chiffres avant de publier ;",
        'si quelque chose cloche, supprime le brouillon et dis-le-moi.'
      ]
        .filter(Boolean)
        .join('\n')
    );

    return { deposit: `draft ${result.depositionId}` };
  } catch (err) {
    console.error('[cron/policy-survey] deposit_threw', {
      error: err instanceof Error ? err.message : String(err)
    });
    return {};
  }
}

/**
 * The two deposit outcomes, by e-mail, because Sentry is not read.
 *
 * alertOps goes to Sentry and nowhere else. That is right for the
 * failures an operator should never have to watch for — but the deposit
 * is the one event in this pipeline that REQUIRES a person: the DOI is
 * a deliberate click and the sixty-day backlink test is counting. It
 * fired at 15:20, Zenodo answered 403, and the only trace was a Sentry
 * message nobody opens. Mounir's first news of it was asking why he had
 * heard nothing.
 *
 * At most one of these per edition, because the deposit is locked to
 * one attempt per edition by construction. A channel that carries one
 * message per quarter is a channel that gets read.
 */
async function emailOperator(subject: string, text: string): Promise<void> {
  const to = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (to.length === 0) {
    console.error('[cron/policy-survey] no_operator_recipients', { subject });
    return;
  }

  const sent = await sendOpsDigest(to, subject, text);
  if (!sent) {
    // Said rather than swallowed: a notification that failed to send is
    // the same as no notification, and this one has a deadline on it.
    console.error('[cron/policy-survey] operator_email_failed', { subject });
    alertOps('cron.observatory_operator_email_failed', { subject });
  }
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
    // Ours, and said so in the string the study reads.
    //
    // We fetched the page, we read it, and then OUR database refused the
    // write. Counting that as a refusal would put a Postgres error into a
    // published denominator and present it as a property of the site.
    // The observatory excludes this code from the study entirely — see
    // OUR_OWN_FAILURES in lib/observatory.ts — so the wording here is
    // load-bearing and not decoration.
    console.error('[cron/policy-survey] snapshot_not_recorded', {
      domain,
      error: snapshotError?.message
    });
    alertOps('cron.policy_survey_snapshot_failed', {
      domain,
      error: snapshotError?.message ?? 'no row returned'
    });
    await finish({ status: 'failed', failure: 'our own storage failed: could not record the document' });
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
      source: sample.sourceId.split('-')[0] ?? 'unknown',
      source_id: sample.sourceId,
      source_label: sample.sourceLabel,
      source_date: sample.sourceDate
    }))
  );

  if (insertError) return { added: 0, refused: `could not store the sample: ${insertError.message}` };

  console.log('[cron/policy-survey] sample_seeded', {
    domains: sample.entries.length,
    sourceId: sample.sourceId,
    sourceLabel: sample.sourceLabel,
    sourceDate: sample.sourceDate
  });
  return { added: sample.entries.length, refused: null };
}
