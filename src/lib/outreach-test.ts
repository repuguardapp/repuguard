import type { Referral } from './referrals';

/**
 * The sixty-day test, with a clock that reports itself.
 *
 * The agreement is one sentence: if the observatory earns no external
 * link within sixty days of the outreach being sent, the SEO channel is
 * dead and we stop adding pages to it rather than arguing with the
 * result.
 *
 * A kill metric nobody is reminded of is not a kill metric. It is an
 * intention, and intentions lose to the sunk cost of the thing they were
 * meant to kill — which is exactly how the CI stayed red for ninety-seven
 * runs while every commit message said the tests passed. So the clock is
 * in the daily digest, every morning, including and especially on the
 * mornings when the answer is nothing.
 *
 * THE COUNTER STARTS AT THE SEND, NOT AT PUBLICATION
 *
 * The study went up on 5 October and the record got its DOI on 8 October.
 * Neither started the clock. The test is whether *telling people* earns a
 * link, so the zero moment is the first message leaving the mailbox:
 * 16 October 2026 at 11:05 Paris time, to Martin Clavey at Next, which is
 * 09:05 UTC.
 *
 * It is a constant and not a row because it is one immutable fact that
 * will never be edited — and a constant is read by anyone opening this
 * file, while a row is read by whoever remembers to query it.
 *
 * NOTHING HERE TOUCHES THE DATABASE
 *
 * The referrers are handed in. This module decides a verdict, and a
 * verdict is the thing most worth testing without a database behind it —
 * the same reason the digest composer next door refuses `server-only`.
 * The caller does the reading; this does the arithmetic and the honesty.
 */
export const OUTREACH_SENT_AT = '2026-10-16T09:05:00Z';

export const OUTREACH_WINDOW_DAYS = 60;

/** The page the test is about. The same string `recordReferral` is given. */
const OBSERVATORY_PATH = '/observatory';

const DAY_MS = 86_400_000;

export interface OutreachTest {
  sentAt: string;
  /** The day the verdict is due, as a date. */
  deadline: string;
  daysElapsed: number;
  /** Zero once the window has closed. */
  daysLeft: number;
  over: boolean;
  /**
   * External hosts that first sent somebody to the observatory AFTER the
   * messages went out. These, and only these, are what the test is about.
   */
  earned: { host: string; firstSeen: string; hits: number }[];
  /**
   * Hosts that were already sending arrivals before the send — Google's
   * crawler among them. Counted separately so an old referrer can never
   * be read as a result of the outreach.
   */
  prior: number;
}

/**
 * Null means we could not read the referrers — never an empty result.
 *
 * "Nobody linked to us" and "we could not tell" are different sentences,
 * and this one decides whether a channel gets killed. Printing the first
 * when the second is true would retire a channel on a database error.
 */
export function outreachTest(
  referrals: Referral[] | null,
  now: Date = new Date()
): OutreachTest | null {
  if (referrals === null) return null;

  const sent = Date.parse(OUTREACH_SENT_AT);
  const deadlineMs = sent + OUTREACH_WINDOW_DAYS * DAY_MS;
  const elapsed = Math.floor((now.getTime() - sent) / DAY_MS);

  const observatory = referrals.filter((r) => r.path === OBSERVATORY_PATH);

  // `firstSeen`, not `lastSeen`. A domain that has linked to us since
  // September and sent somebody again this morning is not a link the
  // outreach earned, and counting it would make the test pass on its
  // own history.
  const earned = observatory
    .filter((r) => Date.parse(r.firstSeen) >= sent)
    .map((r) => ({ host: r.host, firstSeen: r.firstSeen, hits: r.hits }))
    .sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));

  return {
    sentAt: OUTREACH_SENT_AT,
    deadline: new Date(deadlineMs).toISOString().slice(0, 10),
    daysElapsed: Math.max(0, elapsed),
    daysLeft: Math.max(0, Math.ceil((deadlineMs - now.getTime()) / DAY_MS)),
    over: now.getTime() >= deadlineMs,
    earned,
    prior: observatory.length - earned.length
  };
}

/**
 * What this instrument cannot see, said wherever its number is printed.
 *
 * The Referer header only appears when somebody CLICKS. A link that
 * exists and that nobody clicked counts for search ranking and will
 * never show up here. Reporting zero as "nobody linked to us" would be
 * the same confident wrong measurement as an open pixel standing in for
 * interest, and it would retire a channel that was working.
 */
export const OUTREACH_BLIND_SPOT =
  'this counts click-throughs, not links — a link nobody clicked never appears here, and Search Console is what answers that';
