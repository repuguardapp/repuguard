/**
 * What changed since the last report.
 *
 * THE PROBLEM THIS SOLVES
 *
 * The digest opened with fifteen lines that had been byte-identical
 * since 20 October — nine switched-off sources and three barren ones.
 * They are real and they do need a decision, but they are not news.
 *
 * On 23 October the CNIL recovered: the first clean poll since its
 * maintenance window, and the proof that the transient-failure rule
 * shipped the day before had kept it alive long enough to come back.
 * That was the day's only new fact, and in the report it appeared as
 * the ABSENCE of a line the reader would have had to remember from the
 * day before. The instrument shouted the backlog and whispered the
 * change.
 *
 * Pure, and deliberately not `server-only`: it compares two plain
 * objects, which is exactly the part worth testing without a database.
 */

/**
 * The comparable shape of a report.
 *
 * Sets of ids and counts — never the rendered text. Wording changes
 * when the code changes, and a diff against prose would report an edit
 * to a sentence as an operational event.
 */
export interface DigestSnapshot {
  disabled: string[];
  broken: string[];
  barren: string[];
  neverPolled: string[];
  published: number;
  approved: number;
}

export interface DigestDelta {
  /**
   * The date of the report being compared with.
   *
   * Null means there is none — the first run, or an unreadable read.
   * The two are different and the caller is told which, because
   * "nothing changed" and "we cannot tell what changed" are opposite
   * claims and only one of them is reassuring.
   */
  since: string | null;
  /** True when no comparison was possible at all. */
  blind: boolean;

  sourcesOff: string[];
  sourcesBack: string[];
  sourcesBroken: string[];
  sourcesRecovered: string[];
  barrenNew: string[];
  barrenGone: string[];
  neverPolledNew: string[];

  publishedDelta: number;
  approvedDelta: number;
}

const added = (now: string[], before: string[]): string[] =>
  now.filter((id) => !before.includes(id)).sort();

/** Nothing moved, as opposed to nothing being known. */
export function isQuiet(delta: DigestDelta): boolean {
  if (delta.blind) return false;
  return (
    delta.sourcesOff.length === 0 &&
    delta.sourcesBack.length === 0 &&
    delta.sourcesBroken.length === 0 &&
    delta.sourcesRecovered.length === 0 &&
    delta.barrenNew.length === 0 &&
    delta.barrenGone.length === 0 &&
    delta.neverPolledNew.length === 0 &&
    delta.publishedDelta === 0 &&
    delta.approvedDelta === 0
  );
}

/**
 * Compare today with the last stored report.
 *
 * `previous === null` is the honest unknown: the first ever run, or a
 * failed read. It returns `blind: true` and every list empty, and the
 * composer must then print the full state rather than a diff — because
 * with nothing to compare against, calling everything "new" would be a
 * false statement on the first morning and after every outage.
 */
export function diffSnapshots(
  today: DigestSnapshot,
  previous: { takenOn: string; snapshot: DigestSnapshot } | null
): DigestDelta {
  if (previous === null) {
    return {
      since: null,
      blind: true,
      sourcesOff: [],
      sourcesBack: [],
      sourcesBroken: [],
      sourcesRecovered: [],
      barrenNew: [],
      barrenGone: [],
      neverPolledNew: [],
      publishedDelta: 0,
      approvedDelta: 0
    };
  }

  const before = previous.snapshot;

  return {
    since: previous.takenOn,
    blind: false,
    sourcesOff: added(today.disabled, before.disabled),
    // A source that was off and is not any more. Rare, deliberate, and
    // worth a line: somebody repaired a jurisdiction.
    sourcesBack: added(before.disabled, today.disabled),
    sourcesBroken: added(today.broken, before.broken),
    /**
     * The CNIL case. A feed that was failing and is not any more is the
     * one event the old report could not express at all: it showed as a
     * line disappearing, which nobody notices.
     */
    sourcesRecovered: added(before.broken, today.broken),
    barrenNew: added(today.barren, before.barren),
    barrenGone: added(before.barren, today.barren),
    neverPolledNew: added(today.neverPolled, before.neverPolled),
    publishedDelta: today.published - before.published,
    approvedDelta: today.approved - before.approved
  };
}
