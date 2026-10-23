import { describe, expect, it } from 'vitest';
import { composeDigest, type DigestInput } from '@/lib/daily-digest';
import {
  composeRefunds,
  formatRefund,
  parseRefundEvent,
  refundActions,
  totalByCurrency,
  type RefundEvent,
  type WebhookEventRow
} from '@/lib/refunds';
import { quietFunnel } from './support/quiet-funnel';
import { quietDelta } from './support/quiet-delta';

/**
 * The afternoon money went back out and nothing said so.
 *
 * 23 October. The payment path was exercised with a real card: €45.00
 * charged, ten credits provisioned, the subscription mirrored in six
 * seconds, then the charge refunded and the subscription cancelled. The
 * cancellation reached the database in one second. The refund reached
 * nothing at all.
 *
 * The endpoint subscribed to six events — checkout.session.completed,
 * customer.subscription.created / updated / deleted, invoice.paid and
 * invoice.payment_failed. None of them fires when money leaves. It was
 * not that `charge.refunded` was unhandled; it never arrived.
 *
 * What is tested here is not the arithmetic. It is the three ways this
 * particular measurement can lie.
 */

const charge = (over: Record<string, unknown> = {}) => ({
  id: 'ch_3UTmBNKviLwYy4xF2EV4ZAi6',
  amount: 4500,
  amount_refunded: 4500,
  currency: 'eur',
  refunded: true,
  customer: 'cus_VUliVUGhwu8bkw',
  ...over
});

const row = (over: Partial<WebhookEventRow> = {}, chargeOver = {}): WebhookEventRow => ({
  id: 'evt_1',
  type: 'charge.refunded',
  payload: { data: { object: charge(chargeOver) } },
  processed_at: '2026-10-23T17:30:30.000Z',
  ...over
});

const digest = (refunds: RefundEvent[] | null): string =>
  composeDigest({
    auditsCompleted: 0,
    auditsFailed: 0,
    auditsStuck: 0,
    creditsConsumed: 0,
    newOrganizations: 0,
    activeSubscriptions: 0,
    billingMirrorDrift: null,
    corpus: { published: 47 },
    brokenSources: [],
    disabledSources: [],
    neverPolledSources: [],
    barrenSources: [],
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
    // Readable, so a refund assertion is read against a healthy report.
    // A null here puts the digest into degraded-reporting mode and the
    // quiet-day assertion below would fail for the wrong reason — the
    // same trap `funnel.test.ts` documents in its own fixture.
    outreach: {
      sentAt: '2026-10-16T09:05:00Z',
      daysElapsed: 7,
      deadline: '2026-12-15',
      over: false,
      daysLeft: 53,
      earned: [],
      prior: 0
    },
    rejections: { byRule: [], ruleOverflow: 0, byModel: 0, byHuman: 0 },
    funnel: quietFunnel(),
    delta: quietDelta('2026-10-22'),
    refunds,
    appUrl: 'https://lexyflow.com'
  } satisfies DigestInput).text;

describe('an unreadable refund list never prints as no refunds', () => {
  it('says unavailable rather than none', () => {
    // "No money went back out" is the reassuring reading of a line that
    // may simply have failed to load. They are opposite claims.
    expect(composeRefunds(null)).toContain('unavailable');
    expect(composeRefunds(null)).not.toContain('none');
  });

  it('reaches the degraded-reporting list, not the quiet path', () => {
    const text = digest(null);
    expect(text).toContain('COULD NOT BE READ');
    expect(text).toContain('refunds');
  });

  it('raises no action from a list it could not read', () => {
    // A number we do not have must not become a numbered instruction.
    expect(refundActions(null)).toEqual([]);
  });
});

describe('it is printed on the mornings it says nothing', () => {
  it('prints the line when there were no refunds', () => {
    /**
     * A money-out line that appears only when there is money out
     * teaches its reader that absence means nothing — which is how a
     * five-month CI outage stayed invisible in this same report.
     */
    expect(digest([])).toContain('Refunds               none');
  });

  it('does not promote a quiet day to an action', () => {
    expect(digest([])).toContain('Nothing needs you today.');
  });
});

describe('a refund reaches the action list', () => {
  const refunded = parseRefundEvent(row())!;

  it('names the amount and the charge', () => {
    // "1 refund" sends the reader to the dashboard to find out whether
    // it matters. This tells them.
    const text = digest([refunded]);
    expect(text).toContain('NEEDS YOU');
    expect(text).toContain('45.00 EUR');
    expect(text).toContain('ch_3UTmBNKviLwYy4xF2EV4ZAi6');
  });

  it('says the credits were not reversed', () => {
    // The deliberate gap, stated where it is acted on. The webhook does
    // not claw credits back, and a report that named the refund without
    // saying so would imply the books had squared themselves.
    expect(refundActions([refunded])[0]).toContain('not reversed automatically');
  });

  it('distinguishes a partial refund from a full one', () => {
    const partial = parseRefundEvent(row({}, { amount_refunded: 2000, refunded: false }))!;
    expect(refundActions([partial])[0]).toContain('partially refunded');
    expect(refundActions([refunded])[0]).toContain('fully refunded');
  });

  it('counts the refunded part, not the original charge', () => {
    // `charge.refunded` fires on a partial refund too, and `amount` is
    // the size of the original payment. Reporting it would overstate
    // every partial refund by the part we kept.
    const partial = parseRefundEvent(row({}, { amount: 4500, amount_refunded: 2000 }))!;
    expect(partial.amount).toBe(2000);
  });
});

describe('the money is readable', () => {
  it('renders minor units as a person reads them', () => {
    expect(formatRefund(4500, 'eur')).toBe('45.00 EUR');
  });

  it('does not divide a zero-decimal currency by a hundred', () => {
    // We sell in seven locales and JPY is one of them. ¥7,300 refunded
    // would otherwise be reported as ¥73 — a figure wrong by two orders
    // of magnitude, in the one section about money.
    expect(formatRefund(7300, 'jpy')).toBe('7300 JPY');
  });

  it('never adds two currencies into one number', () => {
    const eur = parseRefundEvent(row({ id: 'evt_a' }))!;
    const jpy = parseRefundEvent(row({ id: 'evt_b' }, { amount_refunded: 7300, currency: 'jpy' }))!;
    const total = totalByCurrency([eur, jpy]);
    expect(total).toContain('45.00 EUR');
    expect(total).toContain('7300 JPY');
    expect(total).not.toMatch(/^\d+(\.\d+)?\s+\w+$/);
  });
});

describe('what the parser refuses to guess', () => {
  it('ignores an event of another type', () => {
    expect(parseRefundEvent(row({ type: 'invoice.paid' }))).toBeNull();
  });

  it('returns null rather than inventing an amount', () => {
    /**
     * Stripe versions its API. A payload shaped differently from what
     * we expect must drop out of the list and be logged as a
     * discrepancy — never be reported as a refund of zero, which would
     * read as "money came back and it was nothing".
     */
    expect(parseRefundEvent(row({}, { amount_refunded: undefined }))).toBeNull();
    expect(parseRefundEvent(row({}, { currency: undefined }))).toBeNull();
    expect(parseRefundEvent({ ...row(), payload: null })).toBeNull();
    expect(parseRefundEvent({ ...row(), payload: { data: {} } })).toBeNull();
  });

  it('reads a customer given as an object as well as an id', () => {
    const expanded = parseRefundEvent(row({}, { customer: { id: 'cus_X' } }))!;
    expect(expanded.customerId).toBe('cus_X');
  });

  it('keeps the event id, so a line in the report can be traced', () => {
    expect(parseRefundEvent(row({ id: 'evt_42' }))!.eventId).toBe('evt_42');
  });
});

describe('the webhook subscribes to the event at all', () => {
  it('handles charge.refunded rather than letting it fall through', () => {
    /**
     * The defect was not in a branch — it was the absence of one, and
     * of the Stripe-side subscription that would have made the branch
     * reachable. This asserts our half; the endpoint's `enabled_events`
     * lives in Stripe and is checked there.
     */
    const route = readRoute();
    expect(route).toContain("case 'charge.refunded':");
    expect(route).toContain('handleChargeRefunded');
  });

  it('does not reverse credits in the handler', () => {
    // A deliberate decision, not an oversight: a partial refund, or a
    // customer who already spent them, drives a balance negative.
    const handler = readRoute();
    const body = handler.slice(
      handler.indexOf('async function handleChargeRefunded'),
      handler.indexOf('Top up the org')
    );
    expect(body).not.toContain('add_audit_credits');
  });
});

function readRoute(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(join(__dirname, '..', 'src/app/api/stripe-webhook/route.ts'), 'utf8');
}
