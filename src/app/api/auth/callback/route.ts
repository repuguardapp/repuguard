import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { waitUntil } from '@vercel/functions';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseService } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Magic-link landing endpoint.
 *
 * A GET NO LONGER SIGNS ANYONE IN. This is the whole point of the file.
 *
 * Of 345 accounts, 46 confirmed their email and all 46 "signed in" —
 * and four organisations exist. So 42 sessions were created and then
 * used for nothing at all: not a form abandoned halfway, nothing. The
 * median gap between requesting a link and confirming it was 23
 * seconds, with values at 3, 7 and 8 seconds, spread across dozens of
 * unrelated corporate domains. Corporate mailboxes confirmed at 31.7%,
 * consumer mailboxes at 3.2% — a tenfold gap that tracks whether the
 * employer runs a mail security product, not whether the person was
 * interested.
 *
 * That is Defender Safe Links, Proofpoint URL Defense and Mimecast
 * doing their job: fetching every URL in an inbound message to check it
 * for malware. This route was a GET that consumed a one-time token, so
 * the scanner spent the link on arrival and the human who clicked ten
 * minutes later was told it had expired. We were not losing prospects
 * to a weak product. We were locking them out of the door.
 *
 * So the flow is now two steps:
 *
 *   GET   → records the open, redirects to /{locale}/auth/confirm with
 *           the token still unspent. Any number of scanners may do this
 *           and nothing happens.
 *   POST  → the interstitial's form. Exchanges the token, sets the
 *           cookies, redirects onward.
 *
 * Scanners follow links. They do not fill in forms. That asymmetry is
 * the entire mechanism, and it is the standard mitigation because
 * nothing else survives contact with a product whose job is to click
 * things before you do.
 *
 * The one-click cost is real and it buys something beyond the fix: a
 * screen that names the product and the action before a session is
 * created, which is also what a person should see before being logged
 * in by an email.
 *
 * Why this route does NOT use `createSupabaseServerClient` from
 * lib/supabase-server.ts:
 *   The shared helper reads cookies from `cookies()` (next/headers).
 *   In a Route Handler, `cookies().set()` mutates an in-request
 *   cookie jar that's supposed to attach to the outgoing response
 *   — but it does NOT carry across when you construct a *new*
 *   NextResponse with `NextResponse.redirect(...)`. The cookie is
 *   set on the route's implicit response and then thrown away when
 *   we return the explicit redirect response. The browser walks
 *   away from the callback without a session cookie, the dashboard
 *   render sees no user, and Next.js redirects back to /login —
 *   producing the "magic link drops me at the login page" loop.
 *
 * The fix is to attach the cookies directly to the redirect
 * response object before returning it. We build the response up
 * front and pass its mutator into the Supabase server client.
 */

/**
 * Step one: hand the token to a page with a button on it.
 *
 * Deliberately does nothing that cannot be repeated. A scanner may
 * open this a dozen times; a browser may prefetch it; a user may
 * refresh it. None of that spends the token.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const rawNext = url.searchParams.get('next');

  if (!code && !(tokenHash && type)) return redirectToLogin(url, 'missing_token', rawNext);

  recordTouch('visited', request.headers.get('user-agent'), type);

  const confirm = new URL(`/${localeFrom(rawNext)}/auth/confirm`, url.origin);
  if (code) confirm.searchParams.set('code', code);
  if (tokenHash) confirm.searchParams.set('token_hash', tokenHash);
  if (type) confirm.searchParams.set('type', type);
  confirm.searchParams.set('next', resolveAuthDestination(rawNext));

  const response = NextResponse.redirect(confirm, { status: 303 });
  // Nothing about this hop may be cached or kept by an intermediary:
  // the URL carries a live credential.
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

/**
 * Step two: the interstitial's form. This is where the session is made.
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);

  // Same-origin only. Without this, a hostile page could auto-submit
  // its own magic-link token from the victim's browser and sign them
  // into an account the attacker controls — login CSRF, whose payoff
  // is every document the victim uploads afterwards.
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) {
    console.error('[auth/callback] cross_origin_post', { origin });
    return redirectToLogin(url, 'bad_origin', null);
  }

  const form = await request.formData();
  const code = str(form.get('code'));
  const tokenHash = str(form.get('token_hash'));
  const type = str(form.get('type'));
  const rawNext = str(form.get('next'));

  const safeNext = resolveAuthDestination(rawNext);
  const response = NextResponse.redirect(new URL(safeNext, url.origin), { status: 303 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    return redirectToLogin(url, 'env_not_configured', rawNext);
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      get(name) {
        return request.cookies.get(name)?.value;
      },
      set(name, value, options: CookieOptions) {
        response.cookies.set({ name, value, ...options });
      },
      remove(name, options: CookieOptions) {
        response.cookies.set({ name, value: '', ...options, maxAge: 0 });
      }
    }
  });

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[auth/callback] exchangeCodeForSession failed', error.message);
      recordTouch('failed', request.headers.get('user-agent'), type, error.message);
      return redirectToLogin(url, 'exchange_failed', rawNext);
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'email' | 'recovery' | 'invite' | 'signup' | 'magiclink'
    });
    if (error) {
      console.error('[auth/callback] verifyOtp failed', error.message);
      // Recorded, because only recording success made the table unable
      // to answer the question it exists for: a missing `confirmed` row
      // could mean the visitor never pressed the button, or pressed it
      // and the token was already spent. Those are opposite diagnoses.
      recordTouch('failed', request.headers.get('user-agent'), type, error.message);
      return redirectToLogin(url, 'verify_failed', rawNext);
    }
  } else {
    return redirectToLogin(url, 'missing_token', rawNext);
  }

  recordTouch('confirmed', request.headers.get('user-agent'), type);
  console.log('[auth/callback] session established', { redirectTo: safeNext });
  return response;
}

function str(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Record that a link was opened, and how far it got.
 *
 * Fire-and-forget: a telemetry write must never be the reason a
 * customer cannot sign in. Carries the user agent — which is what
 * separates a scanner from a browser, since they identify themselves —
 * and no email, no token and no IP address.
 */
function recordTouch(
  stage: 'visited' | 'confirmed' | 'failed',
  userAgent: string | null,
  linkType: string | null,
  detail?: string
): void {
  // waitUntil, not a bare floating promise.
  //
  // Vercel freezes the function the moment the response is returned, so
  // an unawaited write is a write that sometimes lands and sometimes
  // does not. That is exactly how alertOps lost Sentry events last
  // week, and I reintroduced it here yesterday. An instrument that
  // reports intermittently is worse than none: it invites conclusions
  // from an absence that means nothing.
  waitUntil(
    (async () => {
      try {
        await supabaseService().from('auth_link_touches').insert({
          stage,
          user_agent: userAgent?.slice(0, 500) ?? null,
          link_type: linkType,
          detail: detail?.slice(0, 200) ?? null
        });
      } catch (err) {
        console.warn('[auth/callback] touch_not_recorded', {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    })()
  );
}

/**
 * The locale to show the interstitial in.
 *
 * Taken from `next`, which the email hook fills from the locale the
 * visitor used when they asked for the link. Landing an Arabic-speaking
 * visitor on an English confirmation screen would make the one screen
 * standing between them and their account the least trustworthy thing
 * they have seen from us.
 */
function localeFrom(rawNext: string | null): string {
  const match = (rawNext ?? '').match(/^\/([a-z]{2}(?:-[a-z]{2})?)\//i);
  return match?.[1]?.toLowerCase() ?? 'en';
}

/**
 * Coerce an attacker- or hook-supplied `next` to a safe destination.
 * Returns `/dashboard` for anything that is missing, root, recursive,
 * or fails the same-origin invariant `/^\/[^/]/` (which blocks
 * `//evil.com` schema-relative redirects).
 */
function resolveAuthDestination(rawNext: string | null): string {
  if (!rawNext || !/^\/[^/]/.test(rawNext)) return '/dashboard';
  if (rawNext === '/') return '/dashboard';
  if (rawNext.startsWith('/api/')) return '/dashboard';
  return rawNext;
}

/**
 * Send someone back to sign in, in their own language.
 *
 * `nextHint` is passed explicitly because the two callers hold it in
 * different places: on a GET it is a query parameter, on a POST it is a
 * form field. Reading only the query string sent every French visitor
 * with an expired link to /en/login — the same locale-drop that made
 * the admin queue unreachable, reproduced in the one flow where the
 * visitor is already having a bad time.
 */
function redirectToLogin(url: URL, reason: string, nextHint: string | null) {
  const dest = new URL(`/${localeFrom(nextHint)}/login`, url.origin);
  dest.searchParams.set('error', reason);
  return NextResponse.redirect(dest, { status: 303 });
}
