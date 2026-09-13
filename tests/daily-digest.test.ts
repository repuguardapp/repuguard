import { describe, expect, it } from 'vitest';
import { composeDigest, type DigestInput } from '../src/lib/daily-digest';

/**
 * The operational brain.
 *
 * Sentry already covers failures loud enough to throw. This covers the
 * ones this system is actually prone to, and every one of them is
 * silent: a feed that stopped returning items, a review queue nobody
 * opened, a month with no revenue. All three look exactly like a quiet
 * week.
 *
 * So the two properties under test are about trust rather than
 * formatting. It must lead with what needs a decision, and it must
 * never report a number it did not manage to read.
 */

const HEALTHY: DigestInput = {
  auditsCompleted: 4,
  auditsFailed: 0,
  auditsStuck: 0,
  creditsConsumed: 3,
  newOrganizations: 1,
  activeSubscriptions: 2,
  corpus: { discovered: 12, extracted: 0, approved: 0, published: 30, rejected: 40 },
  brokenSources: [],
  neverPolledSources: [],
  awaitingReview: 0,
  appUrl: 'https://lexyflow.com'
};

describe('a failed query is never printed as a zero', () => {
  it('says unavailable, not 0', () => {
    const digest = composeDigest({ ...HEALTHY, auditsCompleted: null });

    // "0 audits completed" when the query failed teaches the reader to
    // distrust the whole report — and a digest nobody trusts is worse
    // than none, because it still consumes the attention it was built
    // to save.
    expect(digest.text).toContain('Audits completed      unavailable');
    expect(digest.text).not.toContain('Audits completed      0');
  });

  it('names every figure it could not read, in its own section', () => {
    const digest = composeDigest({ ...HEALTHY, creditsConsumed: null, corpus: null });

    expect(digest.text).toContain('COULD NOT BE READ');
    expect(digest.text).toContain('credits consumed');
    expect(digest.text).toContain('corpus');
    expect(digest.text).toContain('These are not zeros');
  });

  it('never calls a degraded report a quiet day', () => {
    const digest = composeDigest({ ...HEALTHY, activeSubscriptions: null });

    expect(digest.quiet).toBe(false);
    expect(digest.subject).toContain('reporting degraded');
    expect(digest.subject).not.toContain('quiet');
  });
});

describe('it leads with what needs a decision', () => {
  it('puts failing feeds first, with the error and where to fix them', () => {
    const digest = composeDigest({
      ...HEALTHY,
      brokenSources: [{ id: 'cnil', error: 'http_404' }]
    });

    expect(digest.text.indexOf('NEEDS YOU')).toBeLessThan(digest.text.indexOf('LAST 24 HOURS'));
    expect(digest.text).toContain('cnil: http_404');
    expect(digest.text).toContain('/en/admin/ops');
    expect(digest.subject).toContain('1 item(s) need you');
  });

  it('separates a source that has never run from one that failed', () => {
    // Different problems. A source that has never been polled has never
    // been proven to work at all — the state four of ours were in for a
    // full day after being seeded, which is why this exists.
    const digest = composeDigest({
      ...HEALTHY,
      neverPolledSources: ['edpb', 'ico']
    });

    expect(digest.text).toContain('never been polled: edpb, ico');
  });

  it('says the queue blocks publication rather than only counting it', () => {
    const digest = composeDigest({ ...HEALTHY, awaitingReview: 3 });

    expect(digest.text).toContain('3 decision(s) waiting for review');
    expect(digest.text).toContain('nothing publishes until you approve them');
    expect(digest.text).toContain('/en/admin/legal-queue');
  });

  it('reports stuck audits as a pattern worth investigating, not just a count', () => {
    const digest = composeDigest({ ...HEALTHY, auditsStuck: 2 });
    expect(digest.text).toContain('the pipeline is failing');
  });

  it('counts every action in the subject so the inbox line is the summary', () => {
    const digest = composeDigest({
      ...HEALTHY,
      brokenSources: [{ id: 'cnil', error: 'http_404' }],
      awaitingReview: 5,
      auditsFailed: 1
    });
    expect(digest.subject).toBe('LexyFlow — 3 item(s) need you');
  });
});

describe('a genuinely quiet day stays short', () => {
  const digest = composeDigest(HEALTHY);

  it('says so plainly instead of manufacturing an action', () => {
    expect(digest.quiet).toBe(true);
    expect(digest.subject).toBe('LexyFlow — quiet day');
    expect(digest.text).toContain('Nothing needs you today.');
    expect(digest.text).not.toContain('NEEDS YOU');
  });

  it('still carries the numbers, because their absence is the signal', () => {
    // A week of "4 audits" followed by a week of "0" is the only way a
    // solo operator sees demand fall off.
    expect(digest.text).toContain('Audits completed      4');
    expect(digest.text).toContain('Active subscriptions  2');
    expect(digest.text).toContain('published 30');
  });
});
