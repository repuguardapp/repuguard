/**
 * Where a visitor stops.
 *
 * Every other line of the digest reports on the machine: feeds, the
 * corpus, CI, the extraction queue. All of it has been green for weeks
 * while the thing the company is actually failing at went unmeasured —
 * nobody but the operator has ever walked the product end to end.
 *
 * The funnel was repaired step by step over the last three days: the
 * free scan rendered a dead end when no policy was found, the free
 * trial was unreachable through the UI, a new account's first report
 * 404-ed on a stale JWT, the anonymous share link had no read policy,
 * and a signed-in user could escape the paywall. Each of those was a
 * place a visitor disappeared. None of them would have been noticed by
 * any instrument we had, because we had none: the first four were found
 * by the operator walking it himself and the fifth by reading the code.
 *
 * So this is the instrument for the one question the report could not
 * answer. Not "how many" — "where does it stop".
 *
 * WHAT THIS IS NOT, AND WHY IT SAYS SO IN THE EMAIL
 *
 * It is not a cohort. `scans.requested_by` is null on all 309 rows and
 * read by no code, so nothing links the visitor who ran a scan to the
 * organisation that appears an hour later. Five independent counts
 * printed side by side invite a reading they do not support — "11 of 12
 * dropped off" when it may be twelve different people and one unrelated
 * signup.
 *
 * The cohort could be built. It would take a measurement cookie on our
 * own marketing, or an identifier in the URL a visitor carries from the
 * scan to the signup form. We have forbidden ourselves both, in writing,
 * and the reason has not changed because we now want the number. So the
 * limit is printed on every line instead of quietly hoped away: these
 * are stage counts, and the honest question they answer is which stage
 * reports zero first.
 *
 * Pure, and deliberately not `server-only`: it turns numbers into words
 * and the part worth testing is that it never reports a figure it could
 * not read.
 */

/**
 * The five stages, in the order a visitor meets them.
 *
 * `scanRead` is `status = 'done'` rather than "not failed": a scan that
 * failed to find a policy now renders its own result card and is a
 * legitimate answer, but it is not the stage where somebody saw their
 * own document assessed. Counting it here would make the repair look
 * like progress through the funnel.
 */
export const FUNNEL_STAGES = [
  { key: 'scanAsked', label: 'scan asked' },
  { key: 'scanRead', label: 'scan read' },
  { key: 'account', label: 'account' },
  { key: 'audit', label: 'audit' },
  { key: 'paid', label: 'paid' }
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number]['key'];

/** One window. null is a read that failed, and never prints as zero. */
export type FunnelWindow = Record<FunnelStage, number | null>;

export interface Funnel {
  /** The last 24 hours — the row that is new information each morning. */
  day: FunnelWindow;
  /** Since the outreach went out. The row the 60-day verdict rests on. */
  sinceOutreach: FunnelWindow;
  /**
   * Everything, ever.
   *
   * Here for one reason: it makes the age of the numbers visible. All 12
   * public scans are from 20 September and all of them are the
   * operator's. Nothing distinguishes his walk-throughs from a
   * visitor's, so a single cumulative figure would be read as traffic.
   * Three windows side by side make it obvious that the only rows
   * carrying news are the first two.
   */
  allTime: FunnelWindow;
  /** The outreach date, as the label printed beside the row. */
  outreachFrom: string;
}

export const FUNNEL_NOT_A_COHORT =
  'stage counts, not a tracked cohort — nothing links a visitor to the account they create later, and we will not add the cookie that would';

/**
 * The paid stage counts customers whose subscription Stripe calls live
 * now, placed in a window by when that subscription started. Somebody
 * who subscribed and cancelled inside the window is in neither figure.
 * Stated rather than left: it understates, and the direction matters.
 */
export const FUNNEL_PAID_BLIND_SPOT =
  'paid counts subscriptions live now, dated from when they started — one that was taken and cancelled since appears nowhere';

function cell(value: number | null): string {
  return value === null ? '?' : String(value);
}

/**
 * 22, so the values land in the same column as every other STANDING
 * line. The digest is read on a phone in a monospace font and a row that
 * sits two characters left of its neighbours reads as a different
 * section.
 */
const LABEL_WIDTH = 22;

function row(label: string, window: FunnelWindow): string {
  const cells = FUNNEL_STAGES.map((s) => cell(window[s.key])).join(' · ');
  return `  ${label.padEnd(LABEL_WIDTH)}${cells}`;
}

/**
 * The first stage that reports nobody, as a sentence.
 *
 * Returns null when any stage in the window could not be read: naming
 * the first zero requires knowing every count before it, and a guess
 * dressed as a verdict is the failure mode this whole report exists to
 * avoid.
 *
 * Returns null too when nothing fell to zero — there is no stall to
 * report, and inventing one to fill the line would be a sentence about
 * the format rather than about the business.
 */
export function firstStall(window: FunnelWindow): string | null {
  if (FUNNEL_STAGES.some((s) => window[s.key] === null)) return null;

  const counts = FUNNEL_STAGES.map((s) => ({ label: s.label, value: window[s.key] as number }));

  if (counts[0]!.value === 0) return 'nobody has asked for a scan';

  for (let i = 1; i < counts.length; i += 1) {
    const here = counts[i]!;
    const before = counts[i - 1]!;
    if (here.value === 0 && before.value > 0) {
      return `${before.label} → ${here.label}: ${before.value} reached ${before.label}, none went on`;
    }
  }

  return null;
}

/**
 * The funnel block, as digest lines.
 *
 * Printed every morning, including — above all — the mornings every
 * figure is zero. A counter that appears only once it has good news is a
 * counter for the outcomes we had already guessed, which is the mistake
 * this file's first eleven comments are all about.
 */
export function composeFunnel(funnel: Funnel | null): string[] {
  if (funnel === null) return [`  ${'Funnel'.padEnd(LABEL_WIDTH)}unavailable`];

  const header = FUNNEL_STAGES.map((s) => s.label).join(' → ');
  const indent = ' '.repeat(2 + LABEL_WIDTH);
  const lines = [
    `  ${'Funnel'.padEnd(LABEL_WIDTH)}${header}`,
    row('Last 24h', funnel.day),
    row(`Since ${funnel.outreachFrom}`, funnel.sinceOutreach),
    row('All time', funnel.allTime)
  ];

  // The verdict is taken from the outreach window, not the day: a single
  // quiet night says nothing, and the window is the one the kill metric
  // is already measured against.
  const stall = firstStall(funnel.sinceOutreach);
  if (stall) lines.push(`${indent}since ${funnel.outreachFrom}: ${stall}`);

  lines.push(`${indent}${FUNNEL_NOT_A_COHORT}`);
  lines.push(`${indent}${FUNNEL_PAID_BLIND_SPOT}`);

  return lines;
}
