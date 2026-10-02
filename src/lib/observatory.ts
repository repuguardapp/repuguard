import 'server-only';
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

    const [{ data: sample, error: sampleError }, { data: scans, error: scanError }] =
      await Promise.all([
        db.from('survey_domains').select('source_id, source_label, source_date').order('rank').limit(1),
        db
          .from('scans')
          .select('id, status, failure, completed_at')
          .eq('origin', 'survey')
          .not('completed_at', 'is', null)
          .limit(5000)
      ]);

    if (sampleError || scanError) {
      console.error('[observatory] read_failed', {
        error: sampleError?.message ?? scanError?.message
      });
      return null;
    }

    const { count: sampleSize, error: countError } = await db
      .from('survey_domains')
      .select('domain', { head: true, count: 'exact' });
    if (countError) return null;

    const rows = (scans ?? []) as {
      id: string;
      status: string;
      failure: string | null;
      completed_at: string | null;
    }[];

    const read = rows.filter((r) => r.status === 'done');

    const refusalCounts = new Map<FailureCode, number>();
    for (const row of rows.filter((r) => r.status !== 'done')) {
      const code = classifyScanFailure(row.failure);
      refusalCounts.set(code, (refusalCounts.get(code) ?? 0) + 1);
    }

    return {
      sampleSize: sampleSize ?? 0,
      sourceId: (sample?.[0] as { source_id?: string } | undefined)?.source_id ?? null,
      sourceLabel: (sample?.[0] as { source_label?: string } | undefined)?.source_label ?? null,
      sourceDate: (sample?.[0] as { source_date?: string } | undefined)?.source_date ?? null,
      lookedAt: rows.length,
      documentsRead: read.length,
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
