import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_ORG_ID,
  applyPaywall,
  FREE_TRIAL_VISIBLE_FINDINGS,
  isPaywalled
} from '../src/lib/paywall';

/**
 * Pre-launch paywall contract — these tests pin the server-side
 * teaser cut so a future refactor that "helpfully" returns all rows
 * to the client and hides the rest with CSS can't sneak in.
 *
 * The threat model: a free-tier viewer must not be able to retrieve
 * the second-and-later findings of their own audit through any of:
 *   • view-source on the rendered HTML,
 *   • the RSC flight payload,
 *   • a curl of the page route,
 *   • mutating the DOM to drop a `hidden` class,
 *   • re-querying /api/audit/[id] (already covered separately).
 *
 * The defence is to slice on the server before the response leaves
 * the process. `applyPaywall` is the place that slicing happens, so
 * everything below asserts the cut is byte-tight.
 */

describe('isPaywalled', () => {
  const ORG = '11111111-1111-1111-1111-111111111111';

  it('paywalls the free-trial audit of a free-tier owner', () => {
    // The one case the paywall is for: no credit was spent, so nobody
    // has paid for this report. Showing the score and one real finding
    // is the pitch.
    expect(
      isPaywalled({
        organizationId: ORG,
        viewerOwnsAudit: true,
        viewerTier: 'free',
        creditConsumed: false
      })
    ).toBe(true);
  });

  it('does NOT paywall paid-tier owners', () => {
    expect(
      isPaywalled({
        organizationId: ORG,
        viewerOwnsAudit: true,
        viewerTier: 'paid',
        creditConsumed: false
      })
    ).toBe(false);
  });

  /**
   * The regression this exists for. Tier is read from the
   * subscriptions table at render time, so an org whose plan had ended
   * read as 'free' — while still holding prepaid credits it was free
   * to spend. We took the credit, ran the audit, and hid four findings
   * out of five behind an upgrade banner. We had already been paid for
   * those four.
   */
  it('does NOT paywall a report a credit was spent on, even once the plan has ended', () => {
    expect(
      isPaywalled({
        organizationId: ORG,
        viewerOwnsAudit: true,
        viewerTier: 'free',
        creditConsumed: true
      })
    ).toBe(false);
  });

  it('never revokes a purchased report retroactively', () => {
    // A customer on Starter for three months who cancels keeps the
    // reports from months one and two. For a digital good already
    // supplied, taking it back is not a paywall, it is a repossession.
    const whileSubscribed = isPaywalled({
      organizationId: ORG,
      viewerOwnsAudit: true,
      viewerTier: 'paid',
      creditConsumed: true
    });
    const afterCancelling = isPaywalled({
      organizationId: ORG,
      viewerOwnsAudit: true,
      viewerTier: 'free',
      creditConsumed: true
    });
    expect(whileSubscribed).toBe(afterCancelling);
    expect(afterCancelling).toBe(false);
  });

  it('keeps pre-0014 audits readable for anyone still subscribed', () => {
    // Rows written before the credit_consumed column exists carry
    // false whether or not they were paid for. The tier check is what
    // keeps them open, which is why both conditions are kept.
    expect(
      isPaywalled({
        organizationId: ORG,
        viewerOwnsAudit: true,
        viewerTier: 'paid',
        creditConsumed: false
      })
    ).toBe(false);
  });

  it('does NOT paywall non-owners (defence-in-depth)', () => {
    // The page-level guard sends non-owners to notFound earlier; if a
    // future refactor accidentally lets a non-owner reach this point,
    // the paywall predicate still must not be the wall that protects
    // the data — but it must also not silently OPEN the full report
    // to someone who doesn't own it. Returning false here keeps the
    // paywall logic honest: it isn't an auth boundary.
    expect(
      isPaywalled({
        organizationId: ORG,
        viewerOwnsAudit: false,
        viewerTier: 'free',
        creditConsumed: false
      })
    ).toBe(false);
  });

  it('does NOT paywall anonymous-org (public share-link) audits', () => {
    // Share-link audits are by-design fully viewable to anyone with
    // the UUID — they were created without a logged-in subject and
    // have no tier to upgrade. The paywall predicate must stay clear
    // of the anonymous-org bucket even if a future viewer's tier
    // somehow ends up reading 'free' through it.
    expect(
      isPaywalled({
        organizationId: ANONYMOUS_ORG_ID,
        viewerOwnsAudit: true,
        viewerTier: 'free',
        creditConsumed: false
      })
    ).toBe(false);
  });
});

describe('applyPaywall — server-side teaser slicing', () => {
  const fakeFindings = [
    { id: 'f1', severity: 'critical', title: 'Missing DPO', evidence: 'Article 1: …' },
    { id: 'f2', severity: 'high',     title: 'No retention clause', evidence: 'Article 4: …' },
    { id: 'f3', severity: 'medium',   title: 'Vague consent',   evidence: 'Article 7: …' },
    { id: 'f4', severity: 'low',      title: 'Outdated date',   evidence: 'Article 11: …' },
    { id: 'f5', severity: 'info',     title: 'Stylistic nit',   evidence: 'Article 13: …' }
  ];

  it('paid tier: passes all findings through untouched', () => {
    const result = applyPaywall(fakeFindings, false);
    expect(result.visible).toHaveLength(fakeFindings.length);
    expect(result.hidden).toBe(0);
    // Identity sanity: every row from input must be in output.
    expect(result.visible.map((f) => f.id)).toEqual(fakeFindings.map((f) => f.id));
  });

  it('free tier: visible list is exactly the first three findings', () => {
    const result = applyPaywall(fakeFindings, true);
    expect(result.visible).toHaveLength(3);
    expect(result.visible.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    expect(result.hidden).toBe(2);
  });

  it('free tier: shows the three MOST SEVERE, never three arbitrary ones', () => {
    // The caller orders by the severity enum
    // (critical < high < medium < low < info) and this function must
    // preserve that order. A teaser made of "low, info, info" would
    // argue against the product rather than for it.
    const result = applyPaywall(fakeFindings, true);
    expect(result.visible.map((f) => f.severity)).toEqual(['critical', 'high', 'medium']);
  });

  it('shows one finding for every one the constant allows', () => {
    // Pins the slice to the documented constant, so raising or
    // lowering the teaser is a one-line change that the suite follows
    // rather than a change that silently breaks these expectations.
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `g${i}`,
      severity: 'high',
      title: `t${i}`,
      evidence: `e${i}`
    }));
    const result = applyPaywall(many, true);
    expect(result.visible).toHaveLength(FREE_TRIAL_VISIBLE_FINDINGS);
    expect(result.hidden).toBe(20 - FREE_TRIAL_VISIBLE_FINDINGS);
  });

  it('free tier: withheld findings are not present anywhere in the result object', () => {
    // This is the strict server-side contract: the teaser response
    // must not include f2..f5 in any field, including no hidden
    // "shadow" structure that a curious DevTools user could inspect.
    // Serialising the entire result and grep-ing for the withheld
    // ids gives us a defence-in-depth assertion that a future
    // refactor accidentally adding `_all: rows` (or similar) would
    // immediately fail.
    const result = applyPaywall(fakeFindings, true);
    const serialised = JSON.stringify(result);
    for (const f of fakeFindings.slice(FREE_TRIAL_VISIBLE_FINDINGS)) {
      expect(serialised).not.toContain(f.id);
      expect(serialised).not.toContain(f.title);
      expect(serialised).not.toContain(f.evidence);
    }
  });

  it('does not mutate the caller-supplied rows array', () => {
    const input = [...fakeFindings];
    const copy = [...fakeFindings];
    applyPaywall(input, true);
    expect(input).toEqual(copy);
    // And the slice we return is a fresh array, not a view onto the
    // caller's storage — important if the page later sorts in place.
    const result = applyPaywall(input, false);
    expect(result.visible).not.toBe(input);
  });

  it('empty input: visible is [] and hidden is 0 even when paywalled', () => {
    const result = applyPaywall([], true);
    expect(result.visible).toEqual([]);
    expect(result.hidden).toBe(0);
  });

  it('fewer findings than the teaser allows: shows them all, hidden=0', () => {
    // Edge case where the paywall is visually pointless. We expose
    // what there is, but hidden must not go negative — historically a
    // `length - visible.length` calc here produced a `-1` before the
    // Math.max guard landed, and widening the teaser from one to three
    // widens the range of inputs that hit it.
    for (const size of [1, 2, 3]) {
      const rows = fakeFindings.slice(0, size);
      const result = applyPaywall(rows, true);
      expect(result.visible, `${size} rows`).toHaveLength(size);
      expect(result.hidden, `${size} rows`).toBe(0);
    }
  });
});
