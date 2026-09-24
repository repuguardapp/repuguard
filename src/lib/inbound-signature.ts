import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The signature shared by the Cloudflare Email Worker and this application.
 *
 * Extracted into its own module because it is a CONTRACT BETWEEN TWO
 * DEPLOYMENTS, written twice in two runtimes: here against node:crypto, and
 * in infra/cloudflare-email-worker/worker.js against WebCrypto. Two
 * implementations of one recipe is exactly the arrangement that drifts, and
 * when it drifts the symptom is not an error — it is that replies stop
 * arriving and nothing says why.
 *
 * So the recipe lives here, named, with a test that signs a payload the
 * Worker's way and asserts this module accepts it.
 *
 * THE RECIPE
 *
 *   HMAC-SHA256 over `<unix-seconds>.<exact request body>`, hex encoded.
 *
 * Over the raw bytes as received, never over a re-serialised object: JSON
 * round-trips do not preserve key order or whitespace, and a signature that
 * depends on how a parser happened to print the payload is a signature that
 * fails intermittently.
 */

/** Anything older than this is a replay of a captured request. */
export const MAX_SIGNATURE_AGE_SECONDS = 300;

export type SignatureVerdict = 'ok' | 'no_signature' | 'stale' | 'bad_signature';

export function signInbound(timestamp: string, rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function verifyInbound(raw: string, headers: Headers, secret: string): SignatureVerdict {
  const signature = headers.get('x-lexyflow-signature');
  const timestamp = headers.get('x-lexyflow-timestamp');
  if (!signature || !timestamp) return 'no_signature';

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SIGNATURE_AGE_SECONDS) return 'stale';

  return equal(signature, signInbound(timestamp, raw, secret)) ? 'ok' : 'bad_signature';
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // expected length through a 500.
  return left.length === right.length && timingSafeEqual(left, right);
}
