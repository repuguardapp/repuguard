import { describe, expect, it } from 'vitest';
import { composeDigest, type DigestInput } from '@/lib/daily-digest';
import {
  OUTREACH_SENT_AT,
  OUTREACH_WINDOW_DAYS,
  outreachTest
} from '@/lib/outreach-test';
import type { Referral } from '@/lib/referrals';
import { quietFunnel } from './support/quiet-funnel';

/**
 * The kill metric, and the three ways it could lie.
 *
 * The agreement is that if the observatory earns no external link within
 * sixty days of the outreach, the SEO channel dies. That makes this the
 * only counter in the system whose output retires a channel — so it has
 * to be wrong in neither direction, and it has to be unable to stay
 * silent.
 */

const SENT = Date.parse(OUTREACH_SENT_AT);
const DAY = 86_400_000;

function ref(host: string, firstSeenMs: number, path = '/observatory'): Referral {
  const iso = new Date(firstSeenMs).toISOString();
  return { host, path, hits: 1, firstSeen: iso, lastSeen: iso };
}

describe('the sixty-day test cannot be passed by its own history', () => {
  it('counts a referrer that appeared after the send', () => {
    const report = outreachTest([ref('lemonde.fr', SENT + 5 * DAY)], new Date(SENT + 6 * DAY));
    expect(report?.earned.map((e) => e.host)).toEqual(['lemonde.fr']);
  });

  it('does not count a referrer that was already there', () => {
    // Google's crawler has been arriving since September. Counting it
    // would make the test pass on the day it started, against a channel
    // it says nothing about.
    const report = outreachTest([ref('google.com', SENT - 30 * DAY)], new Date(SENT + 6 * DAY));
    expect(report?.earned).toEqual([]);
    expect(report?.prior).toBe(1);
  });

  it('judges on first arrival, not the most recent one', () => {
    // An old referrer that sent somebody again this morning is still an
    // old referrer. `lastSeen` would read as a result of the outreach.
    const old = ref('google.com', SENT - 30 * DAY);
    old.lastSeen = new Date(SENT + 2 * DAY).toISOString();
    expect(outreachTest([old], new Date(SENT + 3 * DAY))?.earned).toEqual([]);
  });

  it('ignores arrivals on pages the study is not about', () => {
    const report = outreachTest([ref('lemonde.fr', SENT + 1 * DAY, '/pricing')], new Date(SENT + 2 * DAY));
    expect(report?.earned).toEqual([]);
  });
});

describe('an unreadable database is never a verdict', () => {
  it('returns null rather than an empty result', () => {
    // "Nobody linked to us" and "we could not tell" are different
    // sentences, and this is the one that kills a channel.
    expect(outreachTest(null)).toBeNull();
  });

  it('reports itself as unreadable in the digest instead of printing none', () => {
    const base = digestInput(null);
    const text = composeDigest(base).text;
    expect(text).toContain('Observatory backlink  unavailable');
    expect(text).toContain('observatory backlink');
    expect(text).toContain('These are not zeros.');
    expect(text).not.toContain('none yet');
  });
});

describe('it reports on the mornings when there is nothing', () => {
  it('prints the clock every day, not only once it has good news', () => {
    const text = composeDigest(digestInput(outreachTest([], new Date(SENT + 3 * DAY)))).text;
    expect(text).toContain('Observatory backlink  none yet · day 3 of 60');
    expect(text).toContain('verdict due 2026-12-15');
  });

  it('says what the counter cannot see, wherever the number appears', () => {
    // The Referer header only exists when somebody clicks. A link nobody
    // clicked counts for ranking and never shows up here, and reading
    // zero as "nobody linked to us" would retire a working channel.
    const text = composeDigest(digestInput(outreachTest([], new Date(SENT + 3 * DAY)))).text;
    expect(text).toContain('a link nobody clicked never appears here');
    expect(text).toContain('Search Console');
  });

  it('is never a quiet day while the verdict is overdue', () => {
    const over = outreachTest([], new Date(SENT + (OUTREACH_WINDOW_DAYS + 1) * DAY));
    const digest = composeDigest(digestInput(over));
    expect(over?.over).toBe(true);
    expect(digest.quiet).toBe(false);
    expect(digest.text).toContain('days are up');
    expect(digest.text).toContain('kill metric');
  });

  it('stops asking for the decision once a link was earned', () => {
    const earned = outreachTest(
      [ref('next.ink', SENT + 2 * DAY)],
      new Date(SENT + (OUTREACH_WINDOW_DAYS + 1) * DAY)
    );
    const digest = composeDigest(digestInput(earned));
    expect(digest.text).toContain('EARNED · next.ink (');
    expect(digest.text).not.toContain('days are up');
  });
});

/** A digest that needs nothing, so the outreach line is what is under test. */
function digestInput(outreach: DigestInput['outreach']): DigestInput {
  return {
    auditsCompleted: 0,
    auditsFailed: 0,
    auditsStuck: 0,
    creditsConsumed: 0,
    newOrganizations: 0,
    activeSubscriptions: 2,
    billingMirrorDrift: null,
    corpus: { discovered: 0, extracted: 0, approved: 0, published: 30, rejected: 0 },
    brokenSources: [],
    neverPolledSources: [],
    disabledSources: [],
    barrenSources: [],
    stalledItems: { count: 0, oldestHours: 0 },
    parkedItems: { count: 0, reasons: [] },
    ci: {
      conclusion: 'success',
      status: 'completed',
      sha: '291caac',
      title: 'ok',
      startedAt: '2026-10-16T09:00:00Z',
      url: 'https://github.com/repuguardapp/repuguard/actions/runs/1',
      failingStreak: 0
    },
    awaitingReview: 0,
    outreach,
    rejections: { byRule: [], ruleOverflow: 0, byModel: 0, byHuman: 0 },
    funnel: quietFunnel(),
    appUrl: 'https://lexyflow.com'
  };
}
