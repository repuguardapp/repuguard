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
        db.from('survey_domains').select('source_id, source_date').order('rank').limit(1),
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
