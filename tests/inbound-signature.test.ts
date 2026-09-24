import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_SIGNATURE_AGE_SECONDS,
  signInbound,
  verifyInbound
} from '../src/lib/inbound-signature';

/**
 * One recipe, two runtimes, and nothing to tell you when they diverge.
 *
 * The Cloudflare Email Worker signs with WebCrypto; this application
 * verifies with node:crypto. If the two ever stop agreeing — a different
 * separator, a different encoding, a re-serialised body — the symptom is not
 * an error anybody sees. It is that prospect replies stop arriving, silently,
 * while both halves report themselves healthy.
 *
 * So the Worker's signing is reimplemented here against WebCrypto, exactly
 * as worker.js does it, and the application's verifier is asked to accept
 * it. This is the one test in the suite whose value is that it uses a
 * DIFFERENT implementation on each side: making both calls go through
 * signInbound would prove only that a function equals itself.
 */

/** Byte-for-byte what infra/cloudflare-email-worker/worker.js does. */
async function signLikeTheWorker(payload: string, secret: string): Promise<string> {
  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const SECRET = 'a-shared-secret-that-lives-in-two-systems';

/** A reply as the Worker assembles it, accents and all. */
const BODY = JSON.stringify({
  messageId: '<CAF=abc123@mail.gmail.com>',
  to: 'replies+Ab3xK9zQw1Er5TyU@go.lexyflow.com',
  from: 'Élodie Martin <elodie@example.test>',
  subject: 'Re: votre audit',
  text: "Merci, mais nous ne sommes pas intéressés — retirez-moi de la liste s'il vous plaît.",
  headers: { 'message-id': '<CAF=abc123@mail.gmail.com>' }
});

function headersFor(signature: string, timestamp: string): Headers {
  return new Headers({
    'x-lexyflow-signature': signature,
    'x-lexyflow-timestamp': timestamp
  });
}

describe('the Worker and the route agree on the signature', () => {
  it('accepts a request signed the way the Worker signs it', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await signLikeTheWorker(`${timestamp}.${BODY}`, SECRET);

    expect(verifyInbound(BODY, headersFor(signature, timestamp), SECRET)).toBe('ok');
  });

  it('produces the same digest from both runtimes, non-ASCII included', async () => {
    // UTF-8 encoding is where two runtimes most plausibly part company, and
    // the bodies this endpoint receives are French, Arabic and Japanese.
    const timestamp = '1790212455'; // any fixed value; both sides must agree on it
    const fromWorker = await signLikeTheWorker(`${timestamp}.${BODY}`, SECRET);
    const fromApp = signInbound(timestamp, BODY, SECRET);

    expect(fromWorker).toBe(fromApp);
  });
});

describe('what the verifier refuses', () => {
  it('refuses a body altered after signing', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await signLikeTheWorker(`${timestamp}.${BODY}`, SECRET);
    const tampered = BODY.replace('pas intéressés', 'très intéressés');

    // The sentiment is the whole point: someone who could flip a refusal
    // into interest could manufacture the number this company is about to
    // make a decision on.
    expect(verifyInbound(tampered, headersFor(signature, timestamp), SECRET)).toBe('bad_signature');
  });

  it('refuses a captured request replayed later', async () => {
    const stale = (Math.floor(Date.now() / 1000) - MAX_SIGNATURE_AGE_SECONDS - 1).toString();
    const signature = await signLikeTheWorker(`${stale}.${BODY}`, SECRET);

    expect(verifyInbound(BODY, headersFor(signature, stale), SECRET)).toBe('stale');
  });

  it('refuses a signature made with a different secret', async () => {
    // The drift case, stated as a test: the Worker holding one value and
    // Vercel another produces exactly this, on every single message.
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await signLikeTheWorker(`${timestamp}.${BODY}`, 'the-other-half-drifted');

    expect(verifyInbound(BODY, headersFor(signature, timestamp), SECRET)).toBe('bad_signature');
  });

  it('refuses an unsigned request', () => {
    expect(verifyInbound(BODY, new Headers(), SECRET)).toBe('no_signature');
  });

  it('refuses a timestamp that is not a number, rather than throwing', () => {
    // Number('later') is NaN, and NaN > 300 is false — so a naive age check
    // lets an unparseable timestamp through as fresh.
    expect(verifyInbound(BODY, headersFor('0'.repeat(64), 'later'), SECRET)).toBe('stale');
  });

  it('does not throw when the signature length differs', () => {
    // timingSafeEqual throws on a length mismatch, and an uncaught throw
    // here would answer 500 — which tells an attacker the expected length.
    // A fresh timestamp, so the check being exercised is the comparison and
    // not the age.
    const fresh = Math.floor(Date.now() / 1000).toString();
    expect(verifyInbound(BODY, headersFor('abc', fresh), SECRET)).toBe('bad_signature');
    expect(verifyInbound(BODY, headersFor('0'.repeat(128), fresh), SECRET)).toBe('bad_signature');
  });
});
