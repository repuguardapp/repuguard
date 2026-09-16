/**
 * Pure server-side paywall primitives, factored out of the audit
 * detail page so the slicing behaviour is unit-testable independently
 * of the React Server Component render path.
 *
 * Why this matters as its own module: the paywall is a security
 * surface, not a UX surface. The whole point of slicing here (rather
 * than hiding with CSS) is that the second-and-later findings must
 * not exist anywhere in the HTML response when the viewer is on the
 * free tier — otherwise a curl, a "view source", or the React Server
 * Components flight payload would leak them. Treating the cut as a
 * pure function lets us assert that contract directly in tests, and
 * lets any future caller (RSS, PDF export, embed, public-share view)
 * reuse the same enforcement without copy-pasting the predicate.
 */

export const ANONYMOUS_ORG_ID = '00000000-0000-0000-0000-000000000000';

export type ViewerTier = 'free' | 'paid';

export interface PaywallContext {
  /** Owning org of the audit row being rendered. */
  organizationId: string;
  /** True iff the viewer's session org id matches the audit row's. */
  viewerOwnsAudit: boolean;
  /** Tier the audit's owner is currently on. */
  viewerTier: ViewerTier;
  /**
   * True iff producing THIS report consumed an audit credit.
   *
   * Recorded on the audit row at the moment it is created, so it is a
   * fact about the purchase and not about the account's state today.
   */
  creditConsumed: boolean;
}

/**
 * Decide whether to paywall this audit for this viewer.
 *
 * The rule, stated plainly: a report the customer paid for is theirs,
 * for ever. The paywall's job is to convert someone who has NOT paid
 * for the report in front of them — which is exactly one case, the
 * free-trial audit.
 *
 * That was not what the code did. Tier is read from the subscriptions
 * table at render time, so an org whose subscription had ended read as
 * 'free' — while still holding prepaid credits it was free to spend.
 * The result was the worst possible combination: we took the credit,
 * ran the audit, and showed one finding out of five with an upgrade
 * banner over the other four. We had already been paid for those four.
 *
 * It also revoked access retroactively. A customer on Starter for
 * three months who cancelled lost the reports from months one and two
 * — reports that were delivered, and paid for, while the plan was
 * active. For a digital good already supplied, that is not a paywall,
 * it is a repossession.
 *
 * So four conditions must ALL hold:
 *   1. The audit isn't an anonymous-org public-share submission
 *      (those are share-link contracts and never get paywalled —
 *      they were created with no logged-in subject and have no
 *      tier to upgrade).
 *   2. The viewer is the owner. Non-owners hit the not-found path
 *      earlier in the request; this guard is defence-in-depth so
 *      that if a future refactor accidentally lets a non-owner
 *      through, they still don't see the full unpaywalled report.
 *   3. The owner's tier is free TODAY. An active subscriber sees
 *      everything, as before.
 *   4. And no credit was spent producing this report.
 *
 * Conditions 3 and 4 together are deliberately more generous than
 * either alone. Audits predating migration 0014 carry
 * credit_consumed = false whether or not they were paid for, and the
 * tier check is what keeps those readable for anyone still
 * subscribed. No customer loses access to a report they can read
 * today.
 *
 * What a subscription still buys is unchanged and is the honest
 * pitch: running NEW audits, and the AI editor. Ongoing work needs an
 * ongoing plan. A report already written does not.
 */
export function isPaywalled(ctx: PaywallContext): boolean {
  return (
    ctx.organizationId !== ANONYMOUS_ORG_ID &&
    ctx.viewerOwnsAudit &&
    ctx.viewerTier === 'free' &&
    !ctx.creditConsumed
  );
}

export interface PaywallSlice<T> {
  /** Rows that will be rendered. Always >= 1 when input is non-empty. */
  visible: T[];
  /** Rows withheld behind the upgrade CTA. Always 0 when not paywalled. */
  hidden: number;
}

/**
 * How many findings the free trial shows in full.
 *
 * It was one, and one was the wrong number. We sell exhaustiveness —
 * every clause of a document checked against every article of a
 * regulation — and then demonstrated it with a single finding above an
 * upgrade banner. A one-item report is not a sample of a thorough
 * audit; it looks like the whole of a shallow one, which is the
 * opposite of the claim it was meant to support.
 *
 * Three costs nothing. The audit has already run and been paid for by
 * us in full: the model calls, the rule cross-referencing and the
 * rewrite drafting all happen before this function is reached, and the
 * withheld rows are sitting in the database either way. The only thing
 * this number changes is how much of work already done we let the
 * prospect see.
 *
 * It is also enough to show the shape of the product — a critical, a
 * high and a medium, each with its citation and its suggested rewrite —
 * while leaving the rest of a typical fifteen-finding report behind the
 * wall. The rows arrive ordered by the severity enum
 * (critical < high < medium < low < info), so the three shown are the
 * three that matter most, never three arbitrary ones.
 */
export const FREE_TRIAL_VISIBLE_FINDINGS = 3;

/**
 * Apply the paywall cut to a list of findings (or any row collection
 * with the same shape).
 *
 * Contract — the things tests pin:
 *   • paywalled=false → visible === input rows, hidden === 0. No-op.
 *   • paywalled=true  → visible has at most FREE_TRIAL_VISIBLE_FINDINGS
 *                       rows, hidden === the remainder.
 *   • Empty input     → visible === [], hidden === 0 even when
 *                       paywalled (no "negative" hidden count).
 *   • Order preserved → the caller's ordering IS the severity
 *                       ordering, so the slice must never reorder.
 *
 * The function never mutates its input; the slice is a fresh array.
 */
export function applyPaywall<T>(rows: readonly T[], paywalled: boolean): PaywallSlice<T> {
  if (!paywalled) {
    return { visible: [...rows], hidden: 0 };
  }
  const visible = rows.slice(0, FREE_TRIAL_VISIBLE_FINDINGS);
  const hidden = Math.max(0, rows.length - visible.length);
  return { visible, hidden };
}
