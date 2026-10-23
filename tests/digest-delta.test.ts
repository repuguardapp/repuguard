import { describe, expect, it } from 'vitest';
import { composeDigest, type DigestInput } from '@/lib/daily-digest';
import { diffSnapshots, isQuiet, type DigestSnapshot } from '@/lib/digest-delta';
import { quietFunnel } from './support/quiet-funnel';
import { quietDelta, blindDelta } from './support/quiet-delta';

/**
 * The morning the report had one thing to say and said nothing.
 *
 * 23 October. The CNIL came back: last_status ok, ten items,
 * consecutive_failures reset — the first clean poll since its
 * maintenance window, and the proof that the transient-failure rule
 * shipped the day before had kept it alive long enough to recover.
 *
 * The digest did not mention it. A recovery appeared only as the
 * DISAPPEARANCE of a line the reader would have had to remember from
 * yesterday, while fifteen lines of backlog — byte-identical since the
 * 20th — held the top of the report.
 *
 * The file that composes it had warned about exactly this, twice:
 *
 *   "a numbered action every morning is how an action list stops being
 *    read"
 *   "four alerts a day for a regulator that withdrew its RSS is how an
 *    alerting channel stops being read"
 *
 * and then let the source lists do it anyway.
 */

const YESTERDAY: DigestSnapshot = {
  disabled: ['adgm_dp_office', 'anpd_br', 'citra_kw', 'edps', 'garante_it'],
  broken: ['cnil'],
  barren: ['aepd_es', 'mtcit_om', 'ppc_jp'],
  neverPolled: [],
  published: 47,
  approved: 0
};

const base = (over: Partial<DigestInput> = {}): DigestInput => ({
  auditsCompleted: 0,
  auditsFailed: 0,
  auditsStuck: 0,
  creditsConsumed: 0,
  newOrganizations: 0,
  activeSubscriptions: 0,
  billingMirrorDrift: null,
  corpus: { published: 47 },
  brokenSources: [],
  disabledSources: YESTERDAY.disabled.map((id) => ({ id, reason: 'switched off earlier' })),
  neverPolledSources: [],
  barrenSources: YESTERDAY.barren.map((id) => ({ id, rejected: 20 })),
  stalledItems: { count: 0, oldestHours: 0 },
  parkedItems: { count: 0, reasons: [] },
  ci: {
    status: 'completed',
    conclusion: 'success',
    sha: 'abc1234',
    title: 'green',
    url: 'https://example.invalid/run',
    failingStreak: 0,
    startedAt: '2026-10-23T06:00:00Z'
  },
  awaitingReview: 0,
  outreach: null,
  rejections: { byRule: [], ruleOverflow: 0, byModel: 0, byHuman: 0 },
  funnel: quietFunnel(),
  delta: quietDelta('2026-10-22'),
  appUrl: 'https://lexyflow.com',
  ...over
});

describe('a recovery is reported, not left as a missing line', () => {
  it('names the feed that started working again', () => {
    const today: DigestSnapshot = { ...YESTERDAY, broken: [] };
    const delta = diffSnapshots(today, { takenOn: '2026-10-22', snapshot: YESTERDAY });

    expect(delta.sourcesRecovered).toEqual(['cnil']);

    const text = composeDigest(base({ delta })).text;
    expect(text).toContain('CHANGED SINCE 2026-10-22');
    expect(text).toContain('recovered');
    expect(text).toContain('cnil');
  });

  it('puts what changed above what needs a decision', () => {
    // A reader who opens this on a phone sees the new thing without
    // scrolling past a backlog they already know about.
    const delta = diffSnapshots({ ...YESTERDAY, broken: [] }, {
      takenOn: '2026-10-22',
      snapshot: YESTERDAY
    });
    const text = composeDigest(base({ delta })).text;
    expect(text.indexOf('CHANGED SINCE')).toBeLessThan(text.indexOf('STANDING'));
  });
});

describe('a backlog that has not moved is counted, not enumerated', () => {
  it('does not re-name sources that were already off', () => {
    /**
     * This is the defect. Nine switched-off sources were printed with
     * their reasons every morning for three days. They still need a
     * decision; they stop asking for one in fifteen lines.
     */
    const text = composeDigest(base()).text;
    expect(text).not.toContain('garante_it');
    expect(text).not.toContain('switched off — they are no longer polled');
  });

  it('still says how many there are, and where the list is', () => {
    // Counted, not hidden. Forgetting the backlog entirely would be the
    // opposite failure.
    const text = composeDigest(base()).text;
    expect(text).toContain('Sources               5 off · 3 barren');
    expect(text).toContain('/en/admin/ops');
  });

  it('names one the morning it goes off', () => {
    const today: DigestSnapshot = { ...YESTERDAY, disabled: [...YESTERDAY.disabled, 'ico_uk'] };
    const delta = diffSnapshots(today, { takenOn: '2026-10-22', snapshot: YESTERDAY });
    expect(delta.sourcesOff).toEqual(['ico_uk']);

    const text = composeDigest(
      base({
        delta,
        disabledSources: today.disabled.map((id) => ({
          id,
          reason: id === 'ico_uk' ? 'Auto-disabled after 5 consecutive failures.' : 'older'
        }))
      })
    ).text;
    expect(text).toContain('NEEDS YOU');
    expect(text).toContain('ico_uk');
    // And only that one — the other four stay counted.
    expect(text).not.toContain('garante_it');
  });
});

describe('"nothing changed" and "we cannot tell" are different reports', () => {
  it('prints the full lists when there is nothing to compare with', () => {
    /**
     * The first ever run, and any morning the snapshot read fails.
     * Calling the whole standing backlog "new" would be false on both,
     * so the report prints the state and says why.
     */
    const text = composeDigest(base({ delta: blindDelta() })).text;
    expect(text).toContain('NO PREVIOUS REPORT TO COMPARE WITH');
    expect(text).toContain('garante_it');
  });

  it('never claims a quiet day when it was blind', () => {
    expect(isQuiet(blindDelta())).toBe(false);
    expect(isQuiet(quietDelta())).toBe(true);
  });

  it('returns blind rather than inventing a comparison', () => {
    const delta = diffSnapshots(YESTERDAY, null);
    expect(delta.blind).toBe(true);
    expect(delta.since).toBeNull();
    expect(delta.sourcesOff).toEqual([]);
  });
});

describe('the comparison is of state, not of prose', () => {
  it('reports a corpus that grew', () => {
    const delta = diffSnapshots({ ...YESTERDAY, published: 51 }, {
      takenOn: '2026-10-22',
      snapshot: YESTERDAY
    });
    expect(delta.publishedDelta).toBe(4);
    expect(composeDigest(base({ delta })).text).toContain('decisions published  +4');
  });

  it('sees no change when only the wording would have changed', () => {
    // The snapshot holds ids and counts. If it held the rendered text,
    // editing a sentence in this repository would surface tomorrow as
    // an operational event.
    const delta = diffSnapshots(YESTERDAY, { takenOn: '2026-10-22', snapshot: { ...YESTERDAY } });
    expect(isQuiet(delta)).toBe(true);
  });
});
