import 'server-only';
import { alertOps } from './alert';
import { classifyScanFailure, type FailureCode } from './scan-failure';
import { supabaseService } from './supabase';

/**
 * The observatory's figures, counted from the same rows the product uses.
 *
 * Nothing here is computed twice or cached into a second number that can
 * disagree with the first. The study reads `scans`, `scan_snapshots` and
 * `scan_observations` — the tables the public scan writes — so a reader
 * who runs the free tool on their own site sees the same seven questions,
 * answered the same way, that the percentage on this page is built from.
 *
 * THE DENOMINATOR IS THE INTERESTING PART
 *
 * Two of them, and the page states both. Of the domains in the sample, a
 * proportion could not be read at all: refused by robots.txt, a 403, a
 * dropped connection, a policy that is a PDF, a page assembled in the
 * browser. Those are counted and broken down rather than dropped, because
 * a study that quietly removes what it could not read is reporting a
 * denominator it invented.
 *
 * The seven observations are then counted over the documents we did read,
 * and the page says so beside every percentage.
 */

/**
 * Failure codes that are about us and therefore about nothing.
 *
 * `our_storage` is a failed insert into our own database after the
 * document was fetched and read. `our_resolver` is `getaddrinfo EBUSY`
 * inside a serverless container — it took ec-lyon.fr, which plainly
 * resolves, so it is our DNS and not their name.
 *
 * Neither tells a reader anything about a French website, and both would
 * otherwise sit in a published refusal breakdown looking exactly like a
 * site that turned us away.
 */
const OUR_OWN_FAILURES = new Set<FailureCode>(['our_storage', 'our_resolver']);

export interface ObservationTally {
  id: string;
  present: number;
  notFound: number;
  unclear: number;
}

export interface ObservatoryReport {
  /** Domains in the population. */
  sampleSize: number;
  /** The ranking the sample came from — the reproducibility claim. */
  sourceId: string | null;
  /** How the ranking describes itself, basis included. */
  sourceLabel: string | null;
  sourceDate: string | null;
  /** Domains we have finished looking at. */
  lookedAt: number;
  /** Of those, how many yielded a document we could read. */
  documentsRead: number;
  /**
   * Scans dropped because the failure was ours, not the site's.
   *
   * Not part of lookedAt and not part of the refusals. Published so the
   * sample is seen to shrink rather than quietly shrinking.
   */
  excluded: number;
  /**
   * Domains the crawl has not reached yet. Zero means the edition is done.
   *
   * NOT `sampleSize - lookedAt`. That was the test, and it can never
   * reach zero: `lookedAt` drops the scans that failed on our side, so
   * the moment one domain hit `getaddrinfo EBUSY` the study became
   * permanently seventeen short of its own sample. The page would have
   * said "collecting" for ever and the Zenodo deposit — which refuses a
   * partial edition, correctly — would never have fired on a crawl that
   * finished.
   *
   * A domain we attempted and lost to our own resolver is not pending
   * work; it is a reading we do not have. The two are different numbers
   * and this is the one that says whether the crawl is still running.
   */
  pending: number;
  /** Why the rest did not, by code. */
  refusals: { code: FailureCode; count: number }[];
  observations: ObservationTally[];
  /** Most recent completed reading, for the "as of" line. */
  lastReadAt: string | null;
}

/** Null means we could not read our own figures — never an empty study. */
export async function observatoryReport(): Promise<ObservatoryReport | null> {
  try {
    // Inside the try, not above it. supabaseService() THROWS when the
    // credentials are absent rather than returning an error, and this
    // function is called during the build — the same mistake that took
    // the /decisions export down for seven locales. A deploy that fails
    // because a database had a bad minute is a deploy schedule owned by
    // the database.
    const db = supabaseService();

    /**
     * Read the sample on its own, not beside the scans.
     *
     * These two ran in one Promise.all and the result was reproducible
     * and absurd: `scans` returned all 297 rows while `survey_domains`
     * returned an empty set, no error, same client, same database —
     * across three Vercel regions and eleven hours. Taking the role
     * PostgREST takes and reading the table directly returns all 297, so
     * neither Postgres, nor RLS, nor the grants, nor the role explain it.
     *
     * What is left is the one thing the two reads shared and the direct
     * read did not: a single client issuing them concurrently. That is a
     * suspicion, not a diagnosis, and it is cheap to remove — the page
     * costs one extra round trip and stops depending on an interleaving
     * nobody can see. If the sample still comes back empty, the status
     * and the body are logged below and the next render says so.
     */
    const sampleResult = await db
      .from('survey_domains')
      .select('source_id, source_label, source_date')
      .order('rank')
      .limit(1);
    const { data: sample, error: sampleError } = sampleResult;

    const { data: scans, error: scanError } = await db
      .from('scans')
      .select('id, domain, status, failure, completed_at')
      .eq('origin', 'survey')
      .not('completed_at', 'is', null)
      .limit(5000);

    if (sampleError || scanError) {
      console.error('[observatory] read_failed', {
        error: sampleError?.message ?? scanError?.message
      });
      return null;
    }

    const { count: sampleSize, error: countError } = await db
      .from('survey_domains')
      .select('domain', { head: true, count: 'exact' });
    if (countError) {
      console.error('[observatory] sample_count_failed', { error: countError.message });
      return null;
    }

    const all = (scans ?? []) as {
      id: string;
      domain: string;
      status: string;
      failure: string | null;
      completed_at: string | null;
    }[];

    /**
     * Scans that failed inside our own infrastructure, dropped from the
     * study entirely rather than counted as refusals.
     *
     * A refusal is a fact about their server or about our reading of
     * their document. "Our Postgres rejected the insert" is neither — we
     * fetched the page and read it, and then we lost it. Counted as a
     * refusal it becomes a published statistic about French websites with
     * a database error inside it; counted as a reading it inflates the
     * denominator with a document nobody can check.
     *
     * So it leaves both, and the number that left is stated. A sample
     * that silently shrinks is a denominator we adjusted after seeing the
     * results, which is the thing this whole module exists not to do.
     */
    const sourceRow = (sample ?? [])[0] as
      | { source_id?: string; source_label?: string; source_date?: string }
      | undefined;

    const excluded = all.filter((r) => OUR_OWN_FAILURES.has(classifyScanFailure(r.failure)));
    const rows = all.filter((r) => !OUR_OWN_FAILURES.has(classifyScanFailure(r.failure)));

    // Every domain the crawl has finished with, whichever way it went.
    // Counted over ALL scans including the excluded ones: a domain lost
    // to our own resolver has been attempted, so it is not still in the
    // queue — it is simply a reading we do not have.
    const attempted = new Set(all.map((r) => r.domain));

    const read = rows.filter((r) => r.status === 'done');

    const refusalCounts = new Map<FailureCode, number>();
    for (const row of rows.filter((r) => r.status !== 'done')) {
      const code = classifyScanFailure(row.failure);
      refusalCounts.set(code, (refusalCounts.get(code) ?? 0) + 1);
    }

    /**
     * A population of zero under a crawl of hundreds is not a study.
     *
     * The published CSV came out with `sample,size,0`, no `source_id`
     * and no `source_date`, while 280 domains had been read and the
     * seven observation counts were correct to the unit. Every figure
     * that came from `scans` was right and every figure that came from
     * `survey_domains` was absent, through one client, on one database,
     * with identical grants.
     *
     * I do not yet know why that read came back empty. What is certain
     * is what the file said: a dataset with no population and no
     * provenance, under a CC BY licence, one click from a permanent DOI
     * — the exact opposite of the reproducibility the method claims.
     *
     * So the incoherence is named rather than served. Not "sampleSize
     * is 0", which is the honest state of a study that has not been
     * seeded yet: scans exist AND the sample does not, which cannot
     * both be true. That is a failure to read our own figures, and this
     * module already has a word for it — null.
     */
    const incoherent = all.length > 0 && ((sampleSize ?? 0) === 0 || !sourceRow?.source_id);
    if (incoherent) {
      /**
       * Four probes, because inference has run out.
       *
       * PostgREST answers 200 with an empty array for this table and 297
       * rows for `scans`, through one client, on a database where the
       * same role reading the same table in SQL sees 297. Owner, RLS,
       * policies, grants, schema, role settings and columns are all
       * identical between the two tables — I have checked each one and
       * none of them explains it.
       *
       * So the next render stops being an opinion: does ANY row come
       * back from this table, does the column we need come back, does
       * the planner think the table has rows, and is the client alive at
       * the same instant for a table that works.
       *
       * NONE OF THEM READS A DOMAIN NAME
       *
       * The first version did — `select('*')` and `select('domain')` —
       * and a guard caught it: the study touches the domain column
       * exactly once, as a head-count that returns a number and no rows,
       * because a list of names is a per-site table and this observatory
       * publishes aggregates. The guard was right and the probe was
       * wrong. `rank` and `source_id` answer the same questions and
       * name nobody.
       *
       * This costs four queries on a path that is already refusing to
       * serve, which is the cheapest place in the system to spend them.
       */
      const [anyRow, sourceOnly, planned, control] = await Promise.all([
        db.from('survey_domains').select('rank').limit(1),
        db.from('survey_domains').select('source_id').limit(1),
        db.from('survey_domains').select('rank', { head: true, count: 'planned' }),
        db.from('survey_runs').select('ran_at', { head: true, count: 'exact' })
      ]);

      console.error('[observatory] sample_probe', {
        anyRowReturned: Array.isArray(anyRow.data) ? anyRow.data.length : -1,
        anyRowStatus: anyRow.status,
        anyRowError: anyRow.error?.message ?? null,
        sourceOnlyReturned: Array.isArray(sourceOnly.data) ? sourceOnly.data.length : -1,
        sourceOnlyError: sourceOnly.error?.message ?? null,
        plannedCount: planned.count,
        plannedError: planned.error?.message ?? null,
        controlTableCount: control.count,
        controlError: control.error?.message ?? null
      });

      console.error('[observatory] sample_missing_under_live_crawl', {
        sampleSize: sampleSize ?? 0,
        sourceId: sourceRow?.source_id ?? null,
        scans: all.length,
        // `[]` and `null` are different answers and the first version of
        // this line could not tell them apart — it logged the length of
        // `sample ?? []` for both. The status is what distinguishes a
        // PostgREST empty set from a response that never carried rows.
        sampleDataIsNull: sample === null,
        sampleRowsReturned: Array.isArray(sample) ? sample.length : -1,
        sampleStatus: sampleResult.status,
        sampleStatusText: sampleResult.statusText
      });
      alertOps('observatory.sample_unreadable', {
        sampleSize: sampleSize ?? 0,
        scans: all.length
      });
      return null;
    }

    return {
      sampleSize: sampleSize ?? 0,
      sourceId: sourceRow?.source_id ?? null,
      sourceLabel: sourceRow?.source_label ?? null,
      sourceDate: sourceRow?.source_date ?? null,
      lookedAt: rows.length,
      documentsRead: read.length,
      excluded: excluded.length,
      pending: Math.max(0, (sampleSize ?? 0) - attempted.size),
      refusals: [...refusalCounts.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count),
      observations: await tallyObservations(db, read.map((r) => r.id)),
      lastReadAt:
        rows
          .map((r) => r.completed_at)
          .filter((d): d is string => Boolean(d))
          .sort()
          .at(-1) ?? null
    };
  } catch (err) {
    console.error('[observatory] read_threw', {
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}

async function tallyObservations(
  db: ReturnType<typeof supabaseService>,
  scanIds: string[]
): Promise<ObservationTally[]> {
  if (scanIds.length === 0) return [];

  // Through the snapshots, because an observation belongs to the document
  // and a scan that recorded no document has no observations to count.
  const { data: snapshots } = await db
    .from('scan_snapshots')
    .select('id')
    .in('scan_id', scanIds)
    .limit(5000);

  const snapshotIds = ((snapshots ?? []) as { id: string }[]).map((s) => s.id);
  if (snapshotIds.length === 0) return [];

  const { data } = await db
    .from('scan_observations')
    .select('observation, finding')
    .in('snapshot_id', snapshotIds)
    .limit(50_000);

  const tally = new Map<string, ObservationTally>();
  for (const row of (data ?? []) as { observation: string; finding: string }[]) {
    const entry = tally.get(row.observation) ?? {
      id: row.observation,
      present: 0,
      notFound: 0,
      unclear: 0
    };
    if (row.finding === 'present') entry.present += 1;
    else if (row.finding === 'not_found') entry.notFound += 1;
    else entry.unclear += 1;
    tally.set(row.observation, entry);
  }

  return [...tally.values()].sort((a, b) => b.present - a.present);
}

/**
 * The licence the dataset is published under.
 *
 * CC BY 4.0, chosen for one reason beyond openness: it REQUIRES
 * attribution. The whole point of publishing this is to be cited, and a
 * licence that obliges a reuser to name the source turns every reuse into
 * the thing we are trying to earn. CC0 would be more generous and would
 * give away the only return we get.
 */
/**
 * Domains that must have been attempted before the dataset exists at all.
 *
 * A third of the sample. Not a statistical threshold — there is no sound
 * one for a census that is simply incomplete — but the point past which
 * a reader who takes the file is looking at a study rather than at a
 * crawl that started this morning.
 *
 * Shared by the page and the download route on purpose. The page has
 * always hidden its figures below the first reading while the file was
 * served to anyone who knew the path, and a CSV is detached from its
 * context by design — that is why it earns a citation, and why it cannot
 * carry the "collecting" banner that makes a partial page honest.
 */
export const MIN_DOMAINS_FOR_DOWNLOAD = 100;

export const OBSERVATORY_LICENCE = 'https://creativecommons.org/licenses/by/4.0/';

/**
 * schema.org/Dataset for the study.
 *
 * This is what Google Dataset Search indexes — a separate index from web
 * search, built for exactly this kind of file, and one where nobody is
 * competing on French privacy-policy statistics.
 *
 * IT IS EMITTED ONLY WHEN THERE IS A DATASET
 *
 * Markup describing a dataset of zero readings is a claim to a machine
 * that something exists when it does not, which is the same act as the
 * sitemap telling Google that 469 unchanged pages had just been modified.
 * Below the first reading this returns null and the page carries no
 * markup at all.
 */
export function observatoryDataset(
  report: ObservatoryReport,
  origin: string,
  locale: string
): Record<string, unknown> | null {
  if (report.lookedAt === 0) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    // Not "most-visited". The sample came from the Majestic Million,
    // which ranks by referring subnets — who links to a site, not who
    // visits it. The visible page was corrected the day that ranking
    // answered; this markup, which is what Google Dataset Search reads,
    // still carried the claim the page had stopped making.
    name: 'Privacy policy disclosures across .fr domains',
    description:
      `Counts of seven disclosures required by the GDPR across .fr domains. ` +
      `${report.documentsRead} privacy policies read of ${report.lookedAt} domains attempted, out of a sample of ${report.sampleSize}` +
      (report.sourceId ? ` drawn from the published ranking ${report.sourceId}` : '') +
      `. Domains that could not be read are counted and broken down by reason rather than dropped. No organisation is named or assessed.`,
    url: `${origin}/${locale}/observatory`,
    license: OBSERVATORY_LICENCE,
    creator: { '@type': 'Organization', name: 'LexyFlow', url: origin },
    isAccessibleForFree: true,
    // The sample's provenance, machine-readable. Without it this is an
    // assertion; with it, it is reproducible.
    ...(report.sourceId
      ? {
          isBasedOn: {
            '@type': 'Dataset',
            name: report.sourceLabel ?? report.sourceId,
            identifier: report.sourceId
          }
        }
      : {}),
    ...(report.lastReadAt ? { dateModified: report.lastReadAt.slice(0, 10) } : {}),
    variableMeasured: report.observations.map((o) => ({
      '@type': 'PropertyValue',
      name: o.id,
      value: o.present,
      // The denominator travels with the number. A value with no
      // denominator is the shape of a figure nobody can check.
      maxValue: o.present + o.notFound + o.unclear
    })),
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'text/csv',
        contentUrl: `${origin}/api/observatory/data.csv`
      }
    ]
  };
}

/**
 * The published dataset, as one string.
 *
 * Shared by the download route and the Zenodo deposit on purpose: the
 * file that receives a permanent DOI has to be the file the page offers,
 * byte for byte. Two builders would drift, and the drift would be
 * invisible — a citation pointing at numbers that no longer match the
 * page they came from.
 */
export function observatoryCsv(report: ObservatoryReport): string {
  const rows: string[][] = [
    ['section', 'key', 'value', 'denominator'],
    ['sample', 'source', report.sourceLabel ?? '', ''],
    ['sample', 'source_id', report.sourceId ?? '', ''],
    ['sample', 'source_date', report.sourceDate ?? '', ''],
    ['sample', 'suffix', '.fr', ''],
    ['sample', 'size', String(report.sampleSize), ''],
    ['sample', 'licence', OBSERVATORY_LICENCE, ''],
    ['progress', 'domains_looked_at', String(report.lookedAt), String(report.sampleSize)],
    ['progress', 'documents_read', String(report.documentsRead), String(report.lookedAt)],
    // Stated in the file, because the file is what gets cited and a
    // sample that shrank without saying so is a denominator nobody can
    // check.
    ['progress', 'excluded_our_own_failure', String(report.excluded), ''],
    ['progress', 'domains_pending', String(report.pending), String(report.sampleSize)],
    ['progress', 'last_read_at', report.lastReadAt ?? '', '']
  ];

  for (const o of report.observations) {
    const total = o.present + o.notFound + o.unclear;
    rows.push(['observation', `${o.id}.present`, String(o.present), String(total)]);
    rows.push(['observation', `${o.id}.not_found`, String(o.notFound), String(total)]);
    rows.push(['observation', `${o.id}.unclear`, String(o.unclear), String(total)]);
  }

  for (const r of report.refusals) {
    rows.push(['refusal', r.code, String(r.count), String(report.lookedAt)]);
  }

  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n') + '\n';
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface SurveyRun {
  ranAt: string;
  ok: boolean;
  reason: string | null;
  seeded: number;
  lookedAt: number;
  observed: number;
  refused: number;
}

/**
 * The last few runs, so a stalled observatory is one query away.
 *
 * Null means the table could not be read. Empty means the cron has never
 * completed a run — which for two days was the true state while every
 * other instrument showed nothing at all.
 */
export async function recentSurveyRuns(limit = 8): Promise<SurveyRun[] | null> {
  try {
    const { data, error } = await supabaseService()
      .from('survey_runs')
      .select('ran_at, ok, reason, seeded, looked_at, observed, refused')
      .order('ran_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[observatory] runs_read_failed', { error: error.message });
      return null;
    }

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      ranAt: String(row.ran_at),
      ok: Boolean(row.ok),
      reason: (row.reason as string | null) ?? null,
      seeded: Number(row.seeded ?? 0),
      lookedAt: Number(row.looked_at ?? 0),
      observed: Number(row.observed ?? 0),
      refused: Number(row.refused ?? 0)
    }));
  } catch (err) {
    console.error('[observatory] runs_read_threw', {
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}
