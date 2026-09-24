import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseService } from './supabase';

/**
 * The right to say no, offered in every marketing email we send.
 *
 * It was not offered in any of them. The unsubscribe machinery in this
 * codebase — the RFC 8058 endpoint, the one-click POST, the careful note
 * about mail scanners — was built for cold outreach and wired only to
 * that path. The three lifecycle emails went out through a different
 * function, and the J+14 one is an explicit commercial solicitation: it
 * pitches the Pro plan and carries a "See the plans" button. It reached
 * an inbox with no opt-out link and no List-Unsubscribe header.
 *
 * Article 21(2) gives an absolute right to object to direct marketing,
 * and the objection has to be offered at the time of each communication.
 * Google and Yahoo have required the one-click header from bulk senders
 * since 2024. We sell audits that check other people for this.
 *
 * THE TOKEN IS DERIVED, NOT STORED
 *
 * HMAC of the address under one server secret, the same shape as the
 * domain-verification token and for the same reasons: stable, so a link
 * in a six-month-old email still works; unguessable without the secret,
 * so nobody can unsubscribe a stranger by walking ids; and free of a
 * table that would have to be written before every send.
 *
 * It also keeps the address out of the URL, which this project forbids
 * outright — an unsubscribe link with an e-mail in it leaks that address
 * to every referrer, proxy and log on the way.
 *
 * WITHOUT THE SECRET WE DO NOT SEND
 *
 * optOutToken returns null when MARKETING_OPTOUT_SECRET is absent, and
 * the caller treats that as a refusal to send rather than as a licence to
 * send without a link. That is the only fail-closed direction that means
 * anything here: an email we cannot let someone escape from is an email
 * we are not entitled to send.
 */

/** Opaque, stable, and not the address. */
export function optOutToken(email: string): string | null {
  const secret = process.env.MARKETING_OPTOUT_SECRET;
  if (!secret) return null;

  return createHmac('sha256', secret)
    .update(`marketing-optout:${normalise(email)}`)
    .digest('base64url')
    .slice(0, 43);
}

/**
 * Which address a token belongs to.
 *
 * A digest cannot be reversed, so the candidates come from the addresses
 * we might have written to, and each is compared in constant time. The
 * caller passes the list; this module does not decide who our recipients
 * are.
 */
export function matchOptOutToken(token: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const expected = optOutToken(candidate);
    if (!expected || expected.length !== token.length) continue;
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(token))) return candidate;
  }
  return null;
}

/** Has this person objected? Errors read as "not opted out" — see below. */
export async function hasOptedOut(email: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseService()
      .from('marketing_optouts')
      .select('email')
      .eq('email', normalise(email))
      .maybeSingle();

    if (error) {
      console.error('[marketing-optout] lookup_failed', { error: error.message });
      // Deliberately NOT fail-closed, and the reasoning is worth
      // recording because it points the other way from the secret above.
      // A database blip must not stop the sequence for everyone; and the
      // send path is gated on the token anyway, so a message that goes
      // out during an outage still carries a working way to object. The
      // risk taken here is one extra email to someone who said no, once,
      // during an incident — against silencing every recipient whenever
      // Supabase has a bad minute.
      return false;
    }
    return !!data;
  } catch (err) {
    console.error('[marketing-optout] lookup_threw', {
      error: err instanceof Error ? err.message : String(err)
    });
    return false;
  }
}

/**
 * Record the objection. Idempotent, and it never fails loudly at the
 * recipient: the endpoint answers 200 either way, because the person
 * clicking has done their part and a 500 would invite them to click
 * again and see the same thing.
 */
export async function recordOptOut(
  email: string,
  source: 'one_click' | 'link' | 'manual'
): Promise<boolean> {
  try {
    const { error } = await supabaseService()
      .from('marketing_optouts')
      .upsert(
        { email: normalise(email), source },
        { onConflict: 'email', ignoreDuplicates: true }
      );

    if (error) {
      console.error('[marketing-optout] write_failed', { error: error.message, source });
      return false;
    }
    // No address in the log line. It is the one field that would turn our
    // own logs into a list of people who refused us.
    console.log('[marketing-optout] recorded', { source });
    return true;
  } catch (err) {
    console.error('[marketing-optout] write_threw', {
      error: err instanceof Error ? err.message : String(err)
    });
    return false;
  }
}

function normalise(email: string): string {
  return email.trim().toLowerCase();
}
