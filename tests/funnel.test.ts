import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeDigest, type DigestInput } from '@/lib/daily-digest';
import {
  FUNNEL_NOT_A_COHORT,
  FUNNEL_STAGES,
  composeFunnel,
  firstStall,
  type Funnel,
  type FunnelWindow
} from '@/lib/funnel';
import { quietFunnel } from './support/quiet-funnel';
import { quietDelta } from './support/quiet-delta';

/**
 * The instrument for the question the digest could not answer.
 *
 * Every other line of that report measures the machine, and the machine
 * has been green for weeks while nobody but the operator walked the
 * product end to end. Five separate funnel defects were found in three
 * days — a dead-end scan result, an unreachable free trial, a 404 on a
 * new account's first report, a share link with no read policy, a
 * paywall a signed-in user could walk around. Four were found by the
 * operator clicking through it himself. Not one by an instrument.
 *
 * What is tested here is not the arithmetic. It is the three ways this
 * particular measurement can lie.
 */

const window = (over: Partial<FunnelWindow> = {}): FunnelWindow => ({
  scanAsked: 0,
  scanRead: 0,
  account: 0,
  audit: 0,
  paid: 0,
  ...over
});

const funnel = (over: Partial<Funnel> = {}): Funnel => ({ ...quietFunnel(), ...over });

const digest = (f: Funnel | null): string =>
  composeDigest({
    auditsCompleted: 0,
    auditsFailed: 0,
    auditsStuck: 0,
    creditsConsumed: 0,
    newOrganizations: 0,
    activeSubscriptions: 0,
    billingMirrorDrift: null,
    corpus: { discovered: 0 },
    brokenSources: [],
    disabledSources: [],
    neverPolledSources: [],
    barrenSources: [],
    // Everything readable, so a funnel assertion is read against a
    // healthy report. The first version of this fixture left four of
    // these null, which put the digest into degraded-reporting mode and
    // would have let a funnel action pass unnoticed behind the warning.
    stalledItems: { count: 0, oldestHours: 0 },
    parkedItems: { count: 0, reasons: [] },
    ci: {
      status: 'completed',
      conclusion: 'success',
      sha: 'abc1234',
      title: 'green',
      url: 'https://example.invalid/run',
      failingStreak: 0,
      startedAt: '2026-10-20T06:00:00Z'
    },
    awaitingReview: 0,
    outreach: {
      sentAt: '2026-10-16T09:05:00Z',
      daysElapsed: 4,
      deadline: '2026-12-15',
      over: false,
      daysLeft: 56,
      earned: [],
      prior: 0
    },
    rejections: { byRule: [], ruleOverflow: 0, byModel: 0, byHuman: 0 },
    funnel: f,
    delta: quietDelta(),
    // Readable and empty: these fixtures assert other things, and a
    // null here would put the digest into degraded-reporting mode.
    refunds: [],
    appUrl: 'https://lexyflow.com'
  } satisfies DigestInput).text;

describe('the entry count measures people, not our own crawler', () => {
  it('filters scans on origin', () => {
    /**
     * `scans` holds 309 rows and 12 of them are people. The other 297
     * have origin 'survey': the observatory's own crawl of .fr domains,
     * run by us against strangers' sites for the ranking study.
     *
     * Without this filter the funnel reports 309 visitors where the true
     * entry count is twelve — a 25× overstatement of the only number
     * that says whether anybody is using the product. It was one missing
     * WHERE clause away, which is why it is asserted here rather than
     * trusted to the comment beside it.
     */
    const route = readFileSync(
      join(__dirname, '..', 'src/app/api/cron/daily-digest/route.ts'),
      'utf8'
    );
    const scanRead = route.slice(route.indexOf('async function readScans'));
    expect(scanRead).toContain(".eq('origin', 'public')");
  });
});

describe('an unreadable stage never prints as nobody', () => {
  it('prints a question mark, not a zero', () => {
    const text = composeFunnel(funnel({ day: window({ scanAsked: null }) })).join('\n');
    // "0 · 0 · 0" and "? · 0 · 0" are opposite claims: one says nobody
    // came, the other says we cannot tell whether anybody came.
    expect(text).toContain('?');
  });

  it('withholds the verdict when any stage could not be read', () => {
    // Naming the first stage that reports nobody requires knowing every
    // count before it. A verdict over a gap is a guess in the voice of a
    // measurement.
    expect(firstStall(window({ scanAsked: 4, scanRead: null, account: 0 }))).toBeNull();
  });

  it('reports the whole funnel as unavailable rather than quiet', () => {
    const text = digest(null);
    expect(text).toContain('Funnel                unavailable');
    expect(text).toContain('COULD NOT BE READ');
    expect(text).toContain('funnel');
    expect(text).toContain('These are not zeros.');
  });
});

describe('it does not imply a conversion rate it cannot measure', () => {
  it('says so on every funnel it prints', () => {
    /**
     * `scans.requested_by` is null on all 309 rows and read by no code,
     * so nothing links the visitor who ran a scan to the organisation
     * that appears an hour later. Five counts side by side invite
     * "11 of 12 dropped off" when it may be twelve people and one
     * unrelated signup.
     *
     * The cohort is buildable — with a measurement cookie on our own
     * marketing, or an identifier carried in the URL from the scan to
     * the signup form. Both are forbidden in writing, and wanting the
     * number is not a reason that changes.
     */
    expect(composeFunnel(funnel()).join('\n')).toContain(FUNNEL_NOT_A_COHORT);
  });

  it('keeps the disclaimer out of reach of a quiet day', () => {
    // A caveat that disappears when the numbers are small is a caveat
    // for the days nobody reads.
    const loud = composeFunnel(
      funnel({ allTime: window({ scanAsked: 900, scanRead: 400, account: 80, audit: 50, paid: 9 }) })
    ).join('\n');
    expect(loud).toContain(FUNNEL_NOT_A_COHORT);
  });
});

describe('the stall verdict', () => {
  it('names the step where people stopped', () => {
    expect(firstStall(window({ scanAsked: 11, scanRead: 7, account: 0 }))).toBe(
      'scan read → account: 7 reached scan read, none went on'
    );
  });

  it('distinguishes nobody arriving from people giving up', () => {
    // Different problems with different owners: one is the acquisition
    // channel, the other is the product. Collapsing them is how three
    // months get spent on the wrong one.
    expect(firstStall(window())).toBe('nobody has asked for a scan');
  });

  it('invents no stall when the funnel holds all the way through', () => {
    expect(
      firstStall(window({ scanAsked: 3, scanRead: 2, account: 2, audit: 1, paid: 1 }))
    ).toBeNull();
  });
});

describe('what reaches the NEEDS YOU list', () => {
  it('raises an action when somebody arrived and stopped', () => {
    const text = digest(
      funnel({ sinceOutreach: window({ scanAsked: 11, scanRead: 7, account: 0 }) })
    );
    expect(text).toContain('NEEDS YOU');
    expect(text).toContain('walked into the funnel and stopped');
    expect(text).toContain('scan read → account');
  });

  it('does not raise one when nobody arrived at all', () => {
    /**
     * An empty funnel is today's expected state and it is already the
     * subject of the backlink line. Promoting it to a numbered action
     * every morning is how a list of actions stops being read — which is
     * the failure this digest was built to escape, not to repeat.
     */
    const text = digest(funnel());
    expect(text).not.toContain('walked into the funnel');
    expect(text).toContain('Nothing needs you today.');
  });

  it('does not raise one from an unreadable funnel', () => {
    const text = digest(funnel({ sinceOutreach: window({ scanAsked: 11, scanRead: null }) }));
    expect(text).not.toContain('walked into the funnel');
  });
});

describe('it is printed on the mornings it says nothing', () => {
  it('shows every stage even when all of them are zero', () => {
    const text = digest(funnel());
    for (const stage of FUNNEL_STAGES) expect(text).toContain(stage.label);
  });

  it('keeps the three windows, so the age of the figures is visible', () => {
    // All 12 public scans are from one afternoon in September and all of
    // them are the operator's. A single cumulative number would read as
    // traffic; three windows make it obvious which rows carry news.
    const text = digest(
      funnel({ allTime: window({ scanAsked: 12, scanRead: 5, account: 6, audit: 3 }) })
    );
    expect(text).toContain('Last 24h');
    expect(text).toContain('Since 2026-10-16');
    expect(text).toContain('All time');
  });
});
