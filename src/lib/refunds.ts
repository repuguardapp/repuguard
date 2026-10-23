/**
 * Money leaving the company, made visible.
 *
 * WHY THIS EXISTS
 *
 * On 23 October the payment path was exercised end to end with a real
 * card: €45.00 charged, ten credits provisioned, the subscription
 * mirrored, then the charge refunded and the subscription cancelled.
 * Every one of those steps appeared somewhere — except the refund.
 *
 * The webhook endpoint subscribed to six events: checkout.session.
 * completed, customer.subscription.created / updated / deleted,
 * invoice.paid and invoice.payment_failed. None of them fires when
 * money goes back out. `charge.refunded` was not among them, so a
 * refund was not merely unhandled — it never arrived. The application
 * carried on as though the money were still ours, and nothing in the
 * morning report would ever have said otherwise.
 *
 * That is survivable while the only refund is our own test. With a
 * paying customer it is the opposite: a refund, or a dispute resolved
 * against us, is the single financial event most worth knowing about
 * and the one the operator is least likely to be watching for.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not claw back credits. A refund is a rare operator action and
 * an automatic reversal has too many bad shapes — a partial refund, a
 * customer who has already spent the credits, a balance driven
 * negative. Recording the event and reporting it is the whole job;
 * deciding what to do about it stays with a human who can see the case.
 *
 * Pure, and deliberately not `server-only`: it turns stored rows into
 * lines, which is the part worth testing without a database.
 */

export interface RefundEvent {
  /** The Stripe event id, so a line in the report can be traced. */
  eventId: string;
  /** Minor units, as Stripe reports them. 4500 is €45.00. */
  amount: number;
  currency: string;
  chargeId: string | null;
  customerId: string | null;
  /** When we processed it, ISO 8601. */
  at: string;
  /**
   * Whether the charge is now fully refunded.
   *
   * `charge.refunded` fires for a partial refund too, and "refunded
   * €20 of €45" and "refunded all of it" are different facts about a
   * customer relationship.
   */
  full: boolean;
}

/** The stored shape: one row of `stripe_webhook_events`. */
export interface WebhookEventRow {
  id: string;
  type: string;
  payload: unknown;
  processed_at: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Read one stored webhook row into a refund, or null if it is not one.
 *
 * Returns null rather than throwing on a payload shaped differently
 * from what we expect: Stripe versions its API, and a digest that dies
 * on an unfamiliar field would take the whole morning report with it.
 * A refund we could not parse is counted by the caller as unreadable,
 * never as absent.
 */
export function parseRefundEvent(row: WebhookEventRow): RefundEvent | null {
  if (row.type !== 'charge.refunded') return null;

  const payload = row.payload as { data?: { object?: Record<string, unknown> } } | null;
  const charge = payload?.data?.object;
  if (!charge || typeof charge !== 'object') return null;

  const amount = charge['amount_refunded'];
  const currency = str(charge['currency']);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || currency === null) return null;

  const customer = charge['customer'];

  return {
    eventId: row.id,
    amount,
    currency: currency.toUpperCase(),
    chargeId: str(charge['id']),
    customerId:
      typeof customer === 'string'
        ? customer
        : str((customer as Record<string, unknown> | null)?.['id']),
    at: row.processed_at,
    full: charge['refunded'] === true
  };
}

/**
 * Minor units to something a person reads.
 *
 * Zero-decimal currencies exist — JPY is one of the seven we sell in —
 * and dividing those by 100 would report a ¥7,300 refund as ¥73.
 */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XAF', 'XOF', 'XPF']);

export function formatRefund(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return `${amount} ${code}`;
  return `${(amount / 100).toFixed(2)} ${code}`;
}

/** Summed per currency, because adding EUR to JPY produces a number that means nothing. */
export function totalByCurrency(refunds: RefundEvent[]): string {
  const byCurrency = new Map<string, number>();
  for (const r of refunds) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + r.amount);
  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, amount]) => formatRefund(amount, code))
    .join(' + ');
}

/**
 * The LAST 24 HOURS line.
 *
 * Printed on quiet mornings too. A money-out line that appears only
 * when there is money out teaches the reader that its absence means
 * nothing, which is exactly the habit that let a five-month CI outage
 * go unread.
 */
export function composeRefunds(refunds: RefundEvent[] | null): string {
  if (refunds === null) return '  Refunds               unavailable';
  if (refunds.length === 0) return '  Refunds               none';
  return `  Refunds               ${refunds.length} · ${totalByCurrency(refunds)}`;
}

/**
 * What reaches NEEDS YOU.
 *
 * A refund gets a numbered action, which is the opposite of the rule
 * applied to switched-off sources — and for the opposite reason. Nine
 * sources that have been off since the 20th are a backlog, and
 * renumbering them every morning is how an action list stops being
 * read. A refund happens rarely enough that it will never become
 * wallpaper, and it is money that left the company.
 *
 * Each one is named with its amount and charge id, because "1 refund"
 * tells the reader to go and look and this tells them whether they
 * need to.
 */
export function refundActions(refunds: RefundEvent[] | null): string[] {
  if (refunds === null || refunds.length === 0) return [];
  return refunds.map((r) => {
    const scope = r.full ? 'fully refunded' : 'partially refunded';
    const where = r.chargeId ? ` (${r.chargeId})` : '';
    return `${formatRefund(r.amount, r.currency)} ${scope}${where}. Credits are not reversed automatically — check whether any were spent.`;
  });
}
