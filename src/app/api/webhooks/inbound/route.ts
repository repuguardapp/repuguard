import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { clientIpFrom, rateLimit } from '@/lib/rate-limit';
import { classifyReply, isAutoReply, topOfReply, type Sentiment } from '@/lib/reply-classifier';
import { supabaseService } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Inbound replies to the outreach sequence, received and understood without
 * anybody reading them.
 *
 * This endpoint's address ends up, by construction, in messages sent to
 * people who did not ask for them. Everything that reaches it is written
 * by a stranger, so the design question is not "how do we parse email" but
 * "what can somebody do to us by sending one".
 *
 * WHO SENT THIS: THE TOKEN, NOT THE FROM HEADER
 *
 * A From header is a line of text the sender chooses. Matching a reply to
 * a prospect by their address would mean anyone who guessed one of our
 * recipients could act on their behalf.
 *
 * So the sequence sends with `Reply-To: replies+<token>@go.lexyflow.com`,
 * and the token in the recipient address is what identifies the thread.
 * The token is unguessable, it is in `outreach_sends`, and it survives
 * every mail client's reply behaviour because clients reply to the address
 * we gave them.
 *
 * The From header is still used as a fallback, but ASYMMETRICALLY, and the
 * asymmetry is the point: a fallback match may unsubscribe a contact and
 * may never do anything else. Someone forging a reply to remove a person
 * from our list has done that person a favour; someone forging one to mark
 * them interested would corrupt the single number this company is about to
 * make a decision on.
 *
 * WHAT A REPLY CAN AND CANNOT CHANGE
 *
 * It can record that a reply happened, what kind it was, and it can opt the
 * person out. It CANNOT set `converted`. That status is written by the
 * audit pipeline when a real audit finishes and by nothing else, so no
 * amount of prompt injection in an email body can manufacture the outcome
 * we are measuring.
 *
 * WHY NOT MAKE
 *
 * Make was going to sit between an IMAP mailbox and this route, poll for
 * new mail, and forward it. It is a paid dependency doing an HTTP POST. A
 * Cloudflare Email Worker does the same thing for nothing, signs the
 * request with a secret we control rather than one a vendor chose, and
 * removes a third party from the path of our prospects' personal data —
 * which, for a company selling GDPR audits, is worth more than the
 * convenience.
 */

/** What the edge worker posts. Deliberately small. */
const Payload = z.object({
  /** Provider's message id, for idempotency. */
  messageId: z.string().min(1).max(512),
  /** Envelope recipient — this is where the token lives. */
  to: z.string().min(3).max(512),
  from: z.string().min(3).max(512),
  subject: z.string().max(998).default(''),
  /** Plain-text body. HTML is not requested and not parsed. */
  text: z.string().max(200_000).default(''),
  /** Lower-cased header names to values; used for auto-reply detection. */
  headers: z.record(z.string()).default({})
});

export async function POST(request: NextRequest) {
  // A public endpoint that costs a model call has to be bounded before it
  // is authenticated, or a signature check is something an attacker makes
  // us do a million times.
  const ip = clientIpFrom(request.headers);
  if (!rateLimit({ key: `inbound:${ip}`, windowMs: 60_000, max: 60 }).ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    // Fails closed and says which variable is missing. The bot gate on the
    // signup form returned success for months when its secret was absent,
    // and nobody could later say whether it had ever been set. A gate whose
    // absence is indistinguishable from its presence is not a gate.
    console.error('[inbound] secret_missing');
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const raw = await request.text();
  const verdict = verify(raw, request.headers, secret);
  if (verdict !== 'ok') {
    console.warn('[inbound] rejected', { verdict });
    // 401 for everything. Distinguishing "bad signature" from "stale
    // timestamp" tells an attacker which half to work on.
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let mail: z.infer<typeof Payload>;
  try {
    mail = Payload.parse(JSON.parse(raw));
  } catch (err) {
    console.warn('[inbound] malformed', { error: err instanceof Error ? err.message : String(err) });
    // 200, not 400: a provider that sees an error retries, and a payload we
    // cannot parse will not parse on the fourth attempt either.
    return NextResponse.json({ ok: true, ignored: 'malformed' });
  }

  const db = supabaseService();

  // Idempotency. A delivery retried after a timeout must not become two
  // replies, and two replies from one person is the difference between
  // "somebody answered" and "somebody is interested" on the dashboard.
  const { data: seen } = await db
    .from('outreach_events')
    .select('id')
    .eq('kind', 'replied')
    .eq('detail', mail.messageId)
    .maybeSingle();

  if (seen) return NextResponse.json({ ok: true, ignored: 'duplicate' });

  const match = await resolveContact(db, mail.to, mail.from);
  if (!match) {
    // Not an error. This address receives whatever the internet sends it.
    console.log('[inbound] no_matching_contact');
    return NextResponse.json({ ok: true, ignored: 'unknown_sender' });
  }

  // Out-of-office first, and from the headers, before anything is spent.
  //
  // Most replies to a cold sequence are absence notices. Reading one as
  // interest would put a number on the dashboard that the entire
  // validation decision rests on — and would pay a model call to get it
  // wrong. RFC 3834 says so in the headers, for free.
  const sentiment: Sentiment = isAutoReply(mail.headers)
    ? 'auto_reply'
    : await classifyReply(mail.text);

  // The reply is recorded whatever the classifier decided, including when
  // it failed. A human answered; that fact is the signal, and the label is
  // a convenience on top of it.
  await db.from('outreach_events').insert({
    send_id: match.sendId,
    contact_id: match.contactId,
    kind: 'replied',
    sentiment,
    // The message id, so the idempotency check above has something to
    // match. No subject line and no body: this table is read on a screen
    // and the body is somebody's correspondence.
    detail: mail.messageId
  });

  if (sentiment === 'unsubscribe') {
    // The one action a reply may take, and it is allowed from a From-header
    // match too. Article 21 does not require the objection to arrive by the
    // route we preferred.
    await db
      .from('outreach_contacts')
      .update({ status: 'unsubscribed', opted_out_at: new Date().toISOString() })
      .eq('id', match.contactId);

    await db.from('outreach_events').insert({
      send_id: match.sendId,
      contact_id: match.contactId,
      kind: 'unsubscribed',
      detail: 'requested in a reply'
    });
  } else if (sentiment !== 'auto_reply' && match.trusted) {
    // `replied`, never `converted`. Conversion is written by the audit
    // pipeline when a real audit finishes; a classifier reading attacker-
    // supplied text must not be able to manufacture the outcome this
    // company is about to decide on.
    await db
      .from('outreach_contacts')
      .update({ status: 'replied' })
      .eq('id', match.contactId)
      .in('status', ['queued', 'sent']);
  }

  console.log('[inbound] recorded', { sentiment, trusted: match.trusted });
  return NextResponse.json({ ok: true, sentiment });
}

/**
 * HMAC over the exact bytes received, with a timestamp.
 *
 * Same shape as the Resend webhook: sign `<timestamp>.<body>`, compare in
 * constant time, and refuse anything older than five minutes so a captured
 * request is not replayable for ever.
 */
function verify(raw: string, headers: Headers, secret: string): 'ok' | 'no_signature' | 'stale' | 'bad_signature' {
  const signature = headers.get('x-lexyflow-signature');
  const timestamp = headers.get('x-lexyflow-timestamp');
  if (!signature || !timestamp) return 'no_signature';

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return 'stale';

  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return equal(signature, expected) ? 'ok' : 'bad_signature';
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak
  // the expected length through a 500.
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Which send this reply belongs to.
 *
 * `trusted` is true only when the token was in the recipient address. A
 * From-header match is a guess about a line the sender wrote, and the
 * caller is careful about what it lets a guess do.
 */
async function resolveContact(
  db: ReturnType<typeof supabaseService>,
  to: string,
  from: string
): Promise<{ sendId: string | null; contactId: string; trusted: boolean } | null> {
  const token = to.match(/\+([A-Za-z0-9_-]{16,64})@/)?.[1];

  if (token) {
    const { data } = await db
      .from('outreach_sends')
      .select('id, contact_id')
      .eq('token', token)
      .maybeSingle();
    if (data) return { sendId: data.id, contactId: data.contact_id, trusted: true };
  }

  // `Name <address@example.com>` or a bare address.
  const address = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  if (!address.includes('@')) return null;

  const { data: contact } = await db
    .from('outreach_contacts')
    .select('id')
    .eq('email', address)
    .maybeSingle();

  return contact ? { sendId: null, contactId: contact.id, trusted: false } : null;
}
