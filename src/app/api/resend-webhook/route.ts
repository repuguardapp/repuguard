import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { suppress } from '@/lib/email-suppression';

/**
 * Resend delivery events — the half of deliverability we never had.
 *
 * 345 magic links went out and nothing came back. A hard bounce meant
 * the mailbox does not exist and we sent to it again; a spam complaint
 * meant someone told their provider we were junk and we sent to them
 * again. Mailbox providers read exactly that pattern, and a sending
 * domain that keeps writing to addresses which have said no stops
 * reaching the ones that have not.
 *
 * Two events are acted on and the rest are acknowledged and dropped:
 *
 *   email.bounced     → suppressed, but only on a HARD bounce. A soft
 *                       bounce is a full mailbox or a server having a
 *                       bad afternoon; suppressing on one would lose a
 *                       customer to their holiday auto-responder.
 *   email.complained  → suppressed, always. Someone pressed "spam".
 *
 * Everything else — delivered, opened, clicked — is deliberately not
 * stored. We are a company whose product is data minimisation; knowing
 * that a named person opened an email at 7:14pm is not something we
 * need, and a table of it is a table we would have to defend.
 *
 * SIGNATURES
 *
 * Resend signs with the Standard Webhooks scheme, which is the same one
 * the Supabase auth hook uses — so the verification here is the same
 * shape as src/app/api/auth/email-hook/route.ts, deliberately, rather
 * than a second dialect of the same thing.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Payload = z.object({
  type: z.string(),
  data: z.object({
    to: z.union([z.string(), z.array(z.string())]).optional(),
    email: z.string().optional(),
    bounce: z.object({ type: z.string().optional() }).partial().optional()
  })
});

/**
 * Standard Webhooks: base64 HMAC-SHA256 over `id.timestamp.body`, with
 * the secret carried as `whsec_<base64>`.
 */
function verify(rawBody: string, headers: Headers, secret: string): boolean {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signatures = headers.get('webhook-signature');
  if (!id || !timestamp || !signatures) return false;

  // Reject anything older than five minutes: a captured delivery must
  // not be replayable for ever.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');

  // The header carries a space-separated list of `v1,<sig>` — a secret
  // may be rotated, so more than one can be valid at once.
  return signatures.split(' ').some((entry) => {
    const provided = entry.split(',')[1];
    if (!provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

function recipients(data: z.infer<typeof Payload>['data']): string[] {
  if (Array.isArray(data.to)) return data.to;
  if (typeof data.to === 'string') return [data.to];
  if (data.email) return [data.email];
  return [];
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Unconfigured is not the same as forbidden, and saying so is what
    // stops an afternoon being spent on the wrong hypothesis.
    console.error('[resend-webhook] secret_not_configured');
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!verify(rawBody, request.headers, secret)) {
    console.error('[resend-webhook] bad_signature');
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
  }

  const parsed = Payload.safeParse(JSON.parse(rawBody));
  if (!parsed.success) {
    // 200, not 400: a shape we do not recognise is not a delivery
    // failure, and telling Resend to retry it for ever helps nobody.
    console.warn('[resend-webhook] unparseable', { error: parsed.error.message });
    return NextResponse.json({ ok: true, ignored: 'unparseable' });
  }

  const { type, data } = parsed.data;
  const addresses = recipients(data);

  if (type === 'email.complained') {
    for (const address of addresses) await suppress(address, 'complained', 'resend webhook');
    return NextResponse.json({ ok: true, suppressed: addresses.length, type });
  }

  if (type === 'email.bounced') {
    // Soft bounces are a full mailbox or a bad afternoon. Suppressing
    // on one would lose a customer to their own holiday auto-reply.
    const hard = (data.bounce?.type ?? '').toLowerCase().includes('hard');
    if (!hard) {
      console.log('[resend-webhook] soft_bounce_ignored', { bounceType: data.bounce?.type });
      return NextResponse.json({ ok: true, ignored: 'soft_bounce' });
    }
    for (const address of addresses) await suppress(address, 'bounced', data.bounce?.type ?? 'hard');
    return NextResponse.json({ ok: true, suppressed: addresses.length, type });
  }

  return NextResponse.json({ ok: true, ignored: type });
}
