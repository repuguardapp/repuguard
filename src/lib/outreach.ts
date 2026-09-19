import 'server-only';
import { supabaseService } from './supabase';

/**
 * Attribution for the automated outreach, kept in one small file.
 *
 * A click is cheap to measure and says almost nothing. The number that
 * answers "does anyone want this" is a stranger who uploaded their own
 * document and waited for the result, and that happens inside the audit
 * route — a place that knows nothing about email campaigns and should
 * keep it that way. So the audit route calls two functions and carries no
 * other knowledge of any of this.
 *
 * WHY THE TOKEN AND NOT A COOKIE
 *
 * A cookie would need a banner, on a site that sells GDPR audits, to
 * measure our own marketing. The token is already in the URL the visitor
 * followed, it identifies a message rather than a person, and it stops
 * existing the moment they navigate away.
 *
 * EVERY FUNCTION HERE FAILS SILENTLY
 *
 * A customer's audit must never fail because our funnel bookkeeping did.
 * If attribution is lost, the event is missing and the dashboard
 * undercounts; if the audit fails, we have lost the thing we were trying
 * to measure.
 */

/** Shape-check before touching the database: these arrive from a URL. */
function plausible(token: string | null | undefined): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(token);
}

async function resolve(token: string): Promise<{ id: string; contact_id: string } | null> {
  const { data } = await supabaseService()
    .from('outreach_sends')
    .select('id, contact_id')
    .eq('token', token)
    .maybeSingle();
  return data ?? null;
}

/**
 * Record that an outreach recipient did something on the site.
 *
 * `audit_started` and `audit_completed` are recorded separately because
 * the gap between them is the most informative number we will get: a
 * stranger who uploads a contract and then leaves before the result has
 * told us something quite different from one who never uploaded.
 */
export async function recordOutreachEvent(
  token: string | null | undefined,
  kind: 'audit_started' | 'audit_completed',
  detail?: string
): Promise<void> {
  if (!plausible(token)) return;

  try {
    const send = await resolve(token);
    if (!send) return;

    const db = supabaseService();
    await db.from('outreach_events').insert({
      send_id: send.id,
      contact_id: send.contact_id,
      kind,
      detail: detail?.slice(0, 200) ?? null
    });

    // A completed audit is the conversion this whole machine exists to
    // count, so it is also written onto the contact — one row to read
    // rather than an aggregate to compute, and it stops the sequence from
    // sending a follow-up to somebody who has already done the thing the
    // follow-up asks for.
    if (kind === 'audit_completed') {
      await db
        .from('outreach_contacts')
        .update({ status: 'converted' })
        .eq('id', send.contact_id)
        .neq('status', 'unsubscribed');
    }
  } catch (err) {
    console.warn('[outreach] event_not_recorded', {
      kind,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
