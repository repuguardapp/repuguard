import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Sign out — and actually clear the cookies while doing it.
 *
 * This route used to build its Supabase client from the shared helper,
 * whose cookie writer goes through `cookies()` in next/headers. Those
 * writes land on the response Next.js generates for you. We then
 * returned a DIFFERENT object — `NextResponse.redirect(...)` — which
 * carried none of them.
 *
 * So signOut() revoked the session server-side and the browser kept its
 * cookie. Supabase's refresh token survives revocation checks long
 * enough to keep a warm session alive, and the next request presented a
 * cookie that still worked. Clicking "sign out" changed nothing visible
 * and nothing durable.
 *
 * On a product holding compliance reports full of names, home addresses
 * and tax identifiers, a sign-out button that does not sign out is
 * worse than not having one: it is the control a person reaches for on
 * a borrowed or shared device, and it told them they were safe.
 *
 * /api/auth/callback already learned this exact lesson in the other
 * direction — it builds the redirect first and writes the session
 * cookies onto it — and the fix here is the same shape. The comment at
 * the top of that file describes the trap; this route simply never
 * applied it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  // Built first, so the cookie clearings below land on the object we
  // actually return.
  const response = NextResponse.redirect(new URL('/', url.origin), { status: 303 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    // Nothing to revoke server-side, but the browser must still lose
    // its cookies — a misconfigured environment is not a reason to
    // leave someone signed in on a device they are walking away from.
    return clearLocally(request, response);
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

  const { error } = await supabase.auth.signOut();
  if (error) {
    // Revocation failed upstream. Still clear the browser: a session
    // the device cannot present is a session it cannot use, and the
    // customer asked to be signed out.
    console.error('[auth/signout] revoke_failed', { error: error.message });
    return clearLocally(request, response);
  }

  return response;
}

/**
 * Expire every Supabase auth cookie on this response.
 *
 * Named by prefix rather than by exact name: @supabase/ssr splits a
 * large session across `sb-<ref>-auth-token.0`, `.1` and so on, and
 * clearing only the base name would leave the chunks behind.
 */
function clearLocally(request: NextRequest, response: NextResponse): NextResponse {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith('sb-')) {
      response.cookies.set({ name: cookie.name, value: '', path: '/', maxAge: 0 });
    }
  }
  return response;
}
