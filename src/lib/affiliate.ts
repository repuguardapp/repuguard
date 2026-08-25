/**
 * Read the affiliate referral id from the incoming request's cookies.
 *
 * Tolt's browser snippet (loaded site-wide in the layout) sets a
 * cookie named `tolt_referral` whose value is the affiliate's
 * partner id. It survives across requests for the configured
 * attribution window (60 days by default) and is included on every
 * subsequent same-origin request — including the POST to
 * /api/checkout that opens the Stripe Checkout Session.
 *
 * We read it server-side and stamp it onto the Stripe Subscription's
 * `metadata.tolt_referral` field. Tolt watches Stripe webhooks
 * independently and self-attributes commissions on every paid
 * subscription whose metadata carries a known partner id.
 *
 * Why server-side reading (vs trusting a body field): a malicious
 * client could spoof any value into the request body, attributing
 * a commission to a partner who never referred them. Reading from
 * the actual cookie header — which the affiliate's link is the only
 * legitimate way to set — closes that.
 *
 * Returns null when the cookie is absent. Callers should pass null
 * through to Stripe unchanged (an unset metadata field is the
 * Stripe-native "no referral" signal).
 */
export function readAffiliateReferral(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  // Cookie header is a single string like `a=1; b=2; tolt_referral=xyz`.
  // We don't pull in a cookie parser for a single name — the regex
  // matches the value up to the next `;` or end of string. Tolt ids
  // are URL-safe base62, so no need to URI-decode.
  const match = /(?:^|;\s*)tolt_referral=([^;]+)/.exec(cookieHeader);
  if (!match || !match[1]) return null;
  const value = match[1].trim();
  // Defensive cap — Tolt ids are ~22 chars; anything longer is
  // either a join attack or a corrupted cookie. We bail.
  if (value.length === 0 || value.length > 64) return null;
  // Sanity charset — base62 + a couple of separators Tolt may use.
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return null;
  return value;
}
