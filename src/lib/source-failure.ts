/**
 * Why a feed failed, and therefore how long to keep trying.
 *
 * THE CASE THIS EXISTS FOR
 *
 * On 22 October the CNIL — France's regulator, our home jurisdiction —
 * stood at four consecutive `http_503` and the watcher disables at five.
 * The next poll would have switched it off. The operator opened the site
 * and found a maintenance page: the 503 was honest, nothing was aimed at
 * us, and there was nothing to repair.
 *
 * The rule that would have killed it treats three different things as
 * one. The Garante went off on a `no_items` — a feed_url that genuinely
 * points at the wrong document. The EDPS went off on a 403 — a refusal,
 * deliberate, which more polling cannot change. A 503 is neither: it is
 * the server saying "come back later", in the one case where coming back
 * later is exactly the right move.
 *
 * The old comment claimed five polls was "long enough that a regulator's
 * maintenance window or a bad afternoon does not disable anything". Five
 * polls is thirty hours. The CNIL's window was longer than that, so the
 * premise was simply untrue, and a verified source that had produced
 * four published decisions was a day and a quarter from silence.
 *
 * WHAT COUNTS AS TRANSIENT
 *
 * Only answers that say, in their own terms, that the condition is
 * temporary: the 5xx family, 408, and 429. Plus transport failures,
 * where no answer arrived at all — a reset or a timeout tells us about
 * the minute, not about the URL.
 *
 * Everything else is terminal by default, and that default is the point.
 * 403 and 404 are decisions the other end has made. `no_items` is a
 * decision WE made badly when we wrote the feed_url. A new failure mode
 * nobody has classified yet should behave like the strict case and
 * surface, not like the patient one and hide.
 */
export type FailureClass = 'transient' | 'terminal';

/**
 * Status codes whose own definition is "not now".
 *
 * 429 is here because rate limiting is the politest possible way of
 * saying come back later, and disabling a regulator for being popular
 * would be absurd.
 */
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Transport-level failures, where nothing was served at all.
 *
 * ENOTFOUND is included deliberately although a domain that stops
 * resolving may well be gone for good. DNS fails for a few minutes more
 * often than domains disappear, and being wrong in this direction costs
 * a week of cheap polling, while being wrong the other way costs a
 * jurisdiction. The weekly ceiling catches the real disappearance.
 */
const TRANSPORT = [
  'fetch failed',
  'etimedout',
  'econnreset',
  'econnrefused',
  'enotfound',
  'eai_again',
  'socket hang up',
  'network',
  'timeout',
  'aborted'
];

export function classifyFailure(error: string): FailureClass {
  const text = error.toLowerCase();

  // `http_503 | candidates: …` — the status is the first token and the
  // suffix is diagnostic noise that must not change the verdict.
  const status = /^http_(\d{3})\b/.exec(text);
  if (status) return TRANSIENT_STATUS.has(Number(status[1])) ? 'transient' : 'terminal';

  if (TRANSPORT.some((needle) => text.includes(needle))) return 'transient';

  return 'terminal';
}

/**
 * Polls to tolerate before switching a source off.
 *
 * The watcher runs every six hours, so these are days:
 *
 *   terminal   5 polls, 30 hours — unchanged. A refusal or a wrong URL
 *              does not improve by waiting, and the point of the rule is
 *              that a dead feed goes quiet within two days.
 *
 *   transient  28 polls, 7 days. A regulator down for a week has a
 *              problem worth a human noticing; a regulator down for a
 *              month has moved, and the ceiling still catches it. The
 *              cost of being patient is one HTTP request every six
 *              hours, which is nothing next to losing France.
 *
 * A source that has never produced an item keeps its own, longer rope
 * (20) because "never worked" and "stopped working" are different
 * questions — but a transient failure tells us nothing about which, so
 * it takes the transient ceiling either way.
 */
export const DISABLE_AFTER_TERMINAL_FAILURES = 5;
export const DISABLE_AFTER_TRANSIENT_FAILURES = 28;
export const DISABLE_UNVERIFIED_AFTER = 20;

export function disableThreshold(error: string, unverified: boolean): number {
  if (classifyFailure(error) === 'transient') return DISABLE_AFTER_TRANSIENT_FAILURES;
  return unverified ? DISABLE_UNVERIFIED_AFTER : DISABLE_AFTER_TERMINAL_FAILURES;
}
