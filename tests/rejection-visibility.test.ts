import { describe, expect, it } from 'vitest';
import { composeDigest, type DigestInput, type RejectionDigest } from '@/lib/daily-digest';
import { quietFunnel } from './support/quiet-funnel';

/**
 * A rejection with a reason reads like the system working.
 *
 * On 20 September the ICO published two documents about Elderly Aids
 * Limited on the same day: an enforcement notice ordering the company to
 * stop, and a monetary penalty notice of £190,000. Neither carried an
 * amount our extractor had managed to read, so the dedup rule matched
 * them on two absent values, rejected the penalty notice as a duplicate
 * of the order, and wrote a sentence explaining itself.
 *
 * The fine left the corpus. Nobody saw it for a month, because the only
 * surface that mentioned any of it was a cumulative `rejected 207` in
 * the daily report — a number that cannot tell a recruitment notice from
 * a sanction.
 *
 * That bug is fixed. The shape is not: two rules delete rows without a
 * human, and they removed 37 items in the thirty days before this test
 * was written.
 */

const base: DigestInput = {
  auditsCompleted: 0,
  auditsFailed: 0,
  auditsStuck: 0,
  creditsConsumed: 0,
  newOrganizations: 0,
  activeSubscriptions: 2,
  billingMirrorDrift: null,
  corpus: { discovered: 0, extracted: 0, approved: 0, published: 30, rejected: 207 },
  brokenSources: [],
  neverPolledSources: [],
  disabledSources: [],
  barrenSources: [],
  stalledItems: { count: 0, oldestHours: 0 },
  parkedItems: { count: 0, reasons: [] },
  ci: {
    conclusion: 'success',
    status: 'completed',
    sha: 'be4a1e2',
    title: 'ok',
    startedAt: '2026-10-19T10:00:00Z',
    url: 'https://github.com/repuguardapp/repuguard/actions/runs/1',
    failingStreak: 0
  },
  awaitingReview: 0,
  outreach: null,
  rejections: { byRule: [], ruleOverflow: 0, byModel: 0, byHuman: 0 },
  funnel: quietFunnel(),
  appUrl: 'https://lexyflow.com'
};

const withRejections = (r: Partial<RejectionDigest>): string =>
  composeDigest({
    ...base,
    rejections: { byRule: [], ruleOverflow: 0, byModel: 0, byHuman: 0, ...r }
  }).text;

describe('what a rule deleted is named, not counted', () => {
  it('prints the title, the reason and the source of each one', () => {
    // Enough to recognise a mistake. A count never is.
    const text = withRejections({
      byRule: [
        {
          title: 'Elderly Aids Limited monetary penalty notice',
          reason: 'duplicate of 9f2a (same authority, date and amount, reported by another source)',
          url: 'https://ico.org.uk/action-weve-taken/elderly-aids'
        }
      ]
    });
    expect(text).toContain('Elderly Aids Limited monetary penalty notice');
    expect(text).toContain('duplicate of 9f2a');
    expect(text).toContain('https://ico.org.uk/action-weve-taken/elderly-aids');
  });

  it('counts the model instead of listing it', () => {
    // Four off-topic press releases a day are the filter doing its job.
    // Listing them buries the line that matters.
    const text = withRejections({ byModel: 4, byHuman: 1 });
    expect(text).toContain('0 by rule · 4 off topic · 1 by you');
  });

  it('says how many it did not print, so a short list is not a quiet one', () => {
    const text = withRejections({
      byRule: [{ title: 'A', reason: 'duplicate of x', url: 'https://e/1' }],
      ruleOverflow: 6
    });
    expect(text).toContain('6 more removed by a rule, not shown');
    // And the headline count includes them.
    expect(text).toContain('7 by rule');
  });

  it('separates the three deciders, because only one of them is a machine', () => {
    const text = withRejections({ byModel: 4, byHuman: 2, byRule: [], ruleOverflow: 3 });
    expect(text).toContain('3 by rule · 4 off topic · 2 by you');
  });
});

describe('an unreadable rejection list is not a quiet day', () => {
  it('says unavailable and lands in the blind-spot block', () => {
    // This is the one state that looks exactly like nothing happening:
    // nothing deleted, and nothing said about it.
    const text = composeDigest({ ...base, rejections: null }).text;
    expect(text).toContain('Rejected (24h)        unavailable');
    expect(text).toContain('COULD NOT BE READ');
    expect(text).toContain('rejections');
    expect(text).toContain('These are not zeros.');
  });

  it('never prints a zero for a read that failed', () => {
    const text = composeDigest({ ...base, rejections: null }).text;
    expect(text).not.toContain('0 by rule');
  });
});
