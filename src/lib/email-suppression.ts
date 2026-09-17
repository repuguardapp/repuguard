import 'server-only';
import { supabaseService } from './supabase';

/**
 * The one gate every outbound email passes through.
 *
 * Deliverability is not destroyed by volume. It is destroyed by writing
 * again to a mailbox that has already said no — a hard bounce, or a
 * spam complaint. Until now nothing on our side recorded either, so the
 * answer to both was to send again next time.
 *
 * Checked in `src/lib/email.ts`, once, rather than at each of the six
 * call sites. A gate with six doors is a gate someone walks around.
 */

/** Structurally undeliverable, independent of what any provider says. */
const NEVER_DELIVERABLE = [
  // US carrier email-to-SMS bridges. A magic link cannot be opened from
  // an SMS, and mail sent to these lands as a text message someone did
  // not ask for. Six of our 345 signups used one.
  'txt.att.net',
  'tmomail.net',
  'vtext.com',
  'messaging.sprintpcs.com',
  'vzwpix.com',
  'mms.att.net'
];

/** Local parts that are a function, not a person, and never sign up. */
const ROLE_LOCAL_PARTS = new Set([
  'abuse',
  'postmaster',
  'noreply',
  'no-reply',
  'mailer-daemon',
  'bounce',
  'bounces'
]);

export function isStructurallyUndeliverable(email: string): string | null {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at < 1) return 'malformed address';

  const domain = address.slice(at + 1);
  if (NEVER_DELIVERABLE.includes(domain)) return `${domain} is an SMS gateway`;

  const local = address.slice(0, at);
  if (ROLE_LOCAL_PARTS.has(local)) return `${local}@ is a role address`;

  return null;
}

/**
 * May we write to this address?
 *
 * Fails OPEN on a database error, deliberately. The alternative is that
 * a Supabase blip silently stops every magic link on the site, and a
 * customer who cannot sign in is a worse outcome than one extra message
 * to an address that already bounced. The error is logged loudly.
 */
export async function isSuppressed(email: string): Promise<{ blocked: boolean; reason?: string }> {
  const structural = isStructurallyUndeliverable(email);
  if (structural) return { blocked: true, reason: structural };

  try {
    const { data, error } = await supabaseService()
      .from('email_suppressions')
      .select('reason, detail')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (error) {
      console.error('[email-suppression] lookup_failed', { error: error.message });
      return { blocked: false };
    }
    if (!data) return { blocked: false };
    return { blocked: true, reason: (data as { reason: string }).reason };
  } catch (err) {
    console.error('[email-suppression] lookup_threw', {
      error: err instanceof Error ? err.message : String(err)
    });
    return { blocked: false };
  }
}

/**
 * Record that an address has said no.
 *
 * Idempotent: the same bounce delivered twice, or a complaint after a
 * bounce, must not error. The first reason recorded is kept, because a
 * hard bounce is a fact about the mailbox and a later complaint does
 * not make it less true.
 */
export async function suppress(
  email: string,
  reason: 'bounced' | 'complained' | 'invalid' | 'manual',
  detail?: string
): Promise<void> {
  const address = email.trim().toLowerCase();
  const { error } = await supabaseService()
    .from('email_suppressions')
    .upsert({ email: address, reason, detail: detail ?? null }, { onConflict: 'email', ignoreDuplicates: true });

  if (error) {
    console.error('[email-suppression] write_failed', { error: error.message, reason });
    return;
  }
  console.log('[email-suppression] suppressed', { reason });
}
