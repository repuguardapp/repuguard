import { NextResponse, type NextRequest } from 'next/server';
import { appUrl } from '@/lib/app-url';
import { supabaseService } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Opposition, in one request, with no page to read and no box to tick.
 *
 * Article 21 says the right to object must be exercisable as easily as the
 * processing was begun. We begin it by sending an email to somebody who
 * never asked; the least we can do is end it with one click. An
 * unsubscribe flow that asks for the address again, or offers a
 * preferences centre, is a dark pattern — and for a company that audits
 * other people's consent mechanisms it is the one thing that cannot be
 * sloppy.
 *
 * TWO METHODS, ON PURPOSE
 *
 * POST is RFC 8058: `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * lets Gmail and Outlook show their own native unsubscribe button and
 * remove the recipient without them opening anything. It is also, since
 * 2024, required by Google and Yahoo for bulk senders — so this endpoint is
 * not a courtesy, it is a condition of being delivered at all.
 *
 * GET is the human who clicked the link in the footer. Mail scanners also
 * follow links, which is why the GET cannot be the only route and why the
 * POST exists: a scanner unsubscribing a prospect who never saw the
 * message would be indistinguishable, in the data, from a refusal.
 *
 * Both are idempotent and neither reveals whether the token was real —
 * answering "unknown" to a wrong token would turn this into an oracle for
 * whether an address is on our list.
 */

export async function POST(_request: NextRequest, { params }: { params: { token: string } }) {
  await optOut(params.token);
  // RFC 8058 wants a 200 and nothing else; the mail client renders its own
  // confirmation.
  return new NextResponse(null, { status: 200 });
}

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  await optOut(params.token);

  const locale = /^[a-z]{2}(-[a-z]{2})?$/i.test(new URL(request.url).searchParams.get('l') ?? '')
    ? new URL(request.url).searchParams.get('l')!.toLowerCase()
    : 'en';

  const done = new URL(`/${locale}/unsubscribed`, appUrl());
  const response = NextResponse.redirect(done, { status: 303 });
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}

/**
 * Awaited, not deferred.
 *
 * Every other telemetry write in this codebase goes through waitUntil
 * because a customer must never wait for our bookkeeping. This one is the
 * exception: it is not telemetry, it is the person's decision, and a
 * decision that lands "usually" is a decision we did not honour. If the
 * write fails the request fails, and the mail client will retry.
 */
async function optOut(token: string): Promise<void> {
  try {
    const db = supabaseService();

    const { data: send } = await db
      .from('outreach_sends')
      .select('id, contact_id')
      .eq('token', token)
      .maybeSingle();

    if (!send) return;

    await db
      .from('outreach_contacts')
      .update({ status: 'unsubscribed', opted_out_at: new Date().toISOString() })
      .eq('id', send.contact_id);

    await db.from('outreach_events').insert({
      send_id: send.id,
      contact_id: send.contact_id,
      kind: 'unsubscribed'
    });
  } catch (err) {
    console.error('[outreach/unsubscribe] failed', {
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  }
}
