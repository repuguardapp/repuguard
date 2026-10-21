/**
 * Which sources poll cleanly and produce nothing.
 *
 * Pulled out of the digest route so the rule can be tested against rows
 * rather than against the route's source text. Four tests in this
 * repository have been written as "the file must contain this word" and
 * all four had to be rewritten when the word moved or appeared in a
 * comment. A rule about data belongs where data can be handed to it.
 *
 * Pure: no database, no `server-only`.
 */

/** Enough classified items to believe the verdict. */
export const BARREN_MIN_CLASSIFIED = 8;

export interface ClassifiedRow {
  source_id: string;
  status: string;
}

/**
 * Sources with a real sample, nothing kept, and still switched on.
 *
 * THE ENABLED FILTER IS THE WHOLE POINT
 *
 * `adgm_dp_office` appeared in BOTH lists of the 21 October digest: among
 * the nine sources switched off, and among the four polling cleanly for
 * nothing. The health buckets filter on `enabled`; this tally reads
 * legal_developments, which carries no such flag, so a source that had
 * already been switched off went on being billed as a live cost.
 *
 * The two lists ask for different things, which is why the overlap is a
 * defect and not a duplicate. A disabled source needs a decision —
 * repair the URL or drop the jurisdiction. A barren one is money: a
 * model call per item, for nothing. A source already off costs nothing.
 *
 * `enabledIds` is null when the source table could not be read, and the
 * answer is then null too: not knowing which sources are on is not the
 * same as all of them being on, and a list built on that guess is how
 * the double-count happened in the first place.
 */
export function barrenSources(
  rows: ClassifiedRow[] | null,
  enabledIds: Set<string> | null,
  minClassified: number = BARREN_MIN_CLASSIFIED
): { id: string; rejected: number }[] | null {
  if (rows === null || enabledIds === null) return null;

  const tally = new Map<string, { kept: number; rejected: number }>();
  for (const row of rows) {
    const entry = tally.get(row.source_id) ?? { kept: 0, rejected: 0 };
    if (row.status === 'rejected') entry.rejected += 1;
    else entry.kept += 1;
    tally.set(row.source_id, entry);
  }

  return [...tally.entries()]
    .filter(([id]) => enabledIds.has(id))
    // A sample worth believing. Three rejections in a row is a quiet
    // fortnight at a regulator, not a verdict on the source.
    .filter(([, t]) => t.kept === 0 && t.rejected >= minClassified)
    .map(([id, t]) => ({ id, rejected: t.rejected }))
    .sort((a, b) => b.rejected - a.rejected);
}
