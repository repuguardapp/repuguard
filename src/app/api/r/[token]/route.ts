import { waitUntil } from '@vercel/functions';
import { NextResponse, type NextRequest } from 'next/server';
import { appUrl } from '@/lib/app-url';
import { supabaseService } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The click, recorded first-party, then the visitor goes where they meant
 * to go.
 *
 * WHY NOT A TRACKING PIXEL, AND WHY NOT A THIRD PARTY
 *
 * An open-tracking pixel measures how many recipients use Apple Mail,
 * which fetches every image in every message before the human sees it —
 * the same machine behaviour that burned our magic links for months. A
 * funnel built on it reports enthusiasm that never happened, which is the
 * error this codebase keeps relearning. So opens are not recorded at all
 * rather than recorded wrongly.
 *
 * A click is different: somebody chose. And it is recorded here, on our
 * own origin, rather than by a tracking provider — a company that sells
 * GDPR audits cannot route its prospects through a third-party tracker to
 * measure them.
 *
 * WHY THE TOKEN CARRIES NOTHING
 *
 * It is an opaque row identifier. The address it belongs to is in the
 * database and never in the URL, so the link can be forwarded, logged by a
 * corporate proxy or pasted into a chat without disclosing who received
 * it. `?e=<base64 email>`, the industry default, leaks the recipient to
 * every intermediary the link passes.
 *
 * WHY IT ALWAYS REDIRECTS
 *
 * An unknown token, a database outage, a malformed row: the visitor still
 * arrives at the page. A person who clicked a link in good faith must
 * never meet an error because our analytics failed — the measurement is
 * ours, the visit is theirs.
 */

/** Where each step's link points. Paths only; the origin is ours. */
const DESTINATIONS: Record<string, string> = {
  sample: '/sample-report',
  audit: '/audit'
};

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const url = new URL(request.url);
  const to = DESTINATIONS[url.searchParams.get('to') ?? 'sample'] ?? DESTINATIONS['sample']!;
  const locale = /^[a-z]{2}(-[a-z]{2})?$/i.test(url.searchParams.get('l') ?? '')
    ? url.searchParams.get('l')!.toLowerCase()
    : 'en';

  const destination = new URL(`/${locale}${to}`, appUrl());
  // The click id travels on, so an audit started from this visit can be
  // attributed without a cookie and without following anyone around.
  destination.searchParams.set('ref', params.token);

  const response = NextResponse.redirect(destination, { status: 302 });
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  // Our own token must not be handed to whatever the destination loads.
  response.headers.set('Referrer-Policy', 'no-referrer');

  // waitUntil, not a floating promise: on Vercel the function freezes the
  // moment the redirect is returned, so an unawaited insert is one that
  // sometimes lands. An intermittent funnel invites conclusions from an
  // absence that means nothing — the mistake that lost Sentry events and
  // then reappeared in the auth callback a day later.
  waitUntil(record(params.token, request.headers.get('user-agent')));

  return response;
}

async function record(token: string, userAgent: string | null): Promise<void> {
  try {
    const db = supabaseService();

    const { data: send } = await db
      .from('outreach_sends')
      .select('id, contact_id')
      .eq('token', token)
      .maybeSingle();

    if (!send) {
      console.warn('[outreach/click] unknown_token');
      return;
    }

    await db.from('outreach_events').insert({
      send_id: send.id,
      contact_id: send.contact_id,
      kind: 'click',
      // The user agent, because a corporate scanner clicking a link in an
      // inbound message is the thing that made 42 of our sessions
      // meaningless. Without it a scanner and a prospect are one number.
      detail: userAgent?.slice(0, 300) ?? null
    });
  } catch (err) {
    console.warn('[outreach/click] not_recorded', {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
