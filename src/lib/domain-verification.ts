import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { promises as dns } from 'node:dns';

/**
 * Proving that somebody controls a domain, so their scan may be indexed.
 *
 * The whole loop rests on this. Anyone may scan any domain and share the
 * link — a link is not a search result and costs the scanned company
 * nothing. Putting another company's name into Google under our analysis is
 * a different act, and the only person entitled to allow it is whoever
 * administers the domain.
 *
 * A DNS TXT record is the right proof because creating one requires access
 * nobody else has, and because it is what every other tool in this
 * industry already asks for: the person doing it has done it before.
 *
 * THE TOKEN IS DERIVED, NOT STORED.
 *
 * HMAC of the domain under one server secret. That makes it stable — the
 * record a customer added last month still verifies today — unguessable
 * without the secret, and free of a table that would have to be kept in
 * step with nothing. It also means a token for example.com cannot be
 * computed from a token for example.net, which a hash of the domain alone
 * would have allowed.
 *
 * WE LOOK UNDER A SUBDOMAIN, NOT AT THE APEX.
 *
 * `_lexyflow.<domain>` rather than the apex, because the apex TXT record
 * holds SPF and DMARC and other people's business. Reading it would mean
 * parsing a customer's mail configuration to find our own string, and
 * asking them to edit that record would mean asking them to risk their
 * email for our indexing.
 */

/** Where the record goes. Printed to the customer verbatim. */
export function verificationRecordName(domain: string): string {
  return `_lexyflow.${domain}`;
}

/**
 * The value they must publish.
 *
 * Fails closed in production when the secret is missing, and says so. The
 * signup bot gate returned success for months while its secret was absent
 * and nobody could later say whether it had ever been set; a verification
 * that silently accepts anything would be worse, because it would grant
 * indexing of other people's names.
 */
export function verificationToken(domain: string): string | null {
  const secret = process.env.DOMAIN_VERIFICATION_SECRET;
  if (!secret) {
    console.error('[verify] DOMAIN_VERIFICATION_SECRET missing');
    return null;
  }

  const digest = createHmac('sha256', secret).update(domain.toLowerCase()).digest('base64url');
  return `lexyflow-site-verification=${digest.slice(0, 32)}`;
}

export interface VerificationResult {
  verified: boolean;
  /** The record we matched, kept so a later dispute is settled by looking. */
  matched?: string;
  /** Why not, as a fact about our lookup. */
  reason?: string;
}

/** DNS is fast or broken; a slow resolver must not hold a request open. */
const LOOKUP_TIMEOUT_MS = 5_000;

/**
 * Does the domain publish our token?
 *
 * Every failure is reported as something about the lookup — "no TXT record
 * at this name", "the record does not match" — never as a judgement about
 * the domain or its owner.
 */
export async function checkDomainTxt(domain: string): Promise<VerificationResult> {
  const expected = verificationToken(domain);
  if (!expected) return { verified: false, reason: 'verification is not configured' };

  const name = verificationRecordName(domain);

  let records: string[][];
  try {
    records = await withTimeout(dns.resolveTxt(name), LOOKUP_TIMEOUT_MS);
  } catch (err) {
    const code = (err as { code?: string }).code;
    // ENODATA and ENOTFOUND are the ordinary answer before the record has
    // propagated, and are not errors to apologise for.
    if (code === 'ENODATA' || code === 'ENOTFOUND') {
      return { verified: false, reason: `no TXT record found at ${name}` };
    }
    return {
      verified: false,
      reason: `could not read DNS for ${name}: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  for (const chunks of records) {
    // A TXT record longer than 255 characters arrives split; the value is
    // the concatenation, which is what every resolver expects.
    const value = chunks.join('').trim();
    if (equal(value, expected)) return { verified: true, matched: value };
  }

  return {
    verified: false,
    reason:
      records.length === 0
        ? `no TXT record found at ${name}`
        : `${records.length} TXT record(s) at ${name}, none matching`
  };
}

/**
 * Constant time, because a token is a credential.
 *
 * Comparing with === would leak how much of the expected value a guess got
 * right, one character at a time. That is a slow attack and an entirely
 * avoidable one.
 */
function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`DNS lookup timed out after ${ms}ms`)), ms)
    )
  ]);
}
