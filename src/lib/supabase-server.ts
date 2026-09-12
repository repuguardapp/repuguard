import 'server-only';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  ADMIN_SESSION_MAX_AGE_MS,
  SESSION_MAX_AGE_MS,
  SESSION_MAX_IDLE_MS,
  evaluateSession,
  sessionIdFromAccessToken,
  type SessionLifetime,
  type SessionPolicy
} from './session-policy';
import { supabaseService } from './supabase';

/**
 * Supabase client for App-Router server components and Route Handlers.
 *
 * - Reads the session from the encrypted Supabase cookies set during the
 *   magic-link callback.
 * - Writes refreshed cookies back when Supabase rotates the access token.
 * - Falls into a no-op cookie store when called from a Server Component
 *   (where cookies are read-only) — the next request resolves the refresh.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase public env not configured');

  return createServerClient(url, anon, {
    cookies: {
      get(name) {
        return cookieStore.get(name)?.value;
      },
      set(name, value, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Read-only context (Server Component) — the next Route Handler
          // call will re-write the cookie. Safe to swallow.
        }
      },
      remove(name, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: '', ...options, maxAge: 0 });
        } catch {
          // Same rationale as above.
        }
      }
    }
  });
}

/**
 * Returns the authenticated user, or null.
 *
 * "Authenticated" here means more than Supabase accepting the token. A
 * Supabase session on the free plan never expires — the access token
 * rotates hourly against a refresh token with no end date — so
 * getUser() alone would keep saying yes to a browser last used two
 * months ago. This function applies our own time-box and inactivity
 * timeout on top, and returns null once either is exceeded.
 *
 * Returning null rather than throwing is deliberate: every caller
 * already handles "not signed in" by redirecting to /login, which is
 * exactly the right outcome, and it means the policy needed no changes
 * at any call site.
 *
 * Pass `policy` to tighten it — the admin surfaces do. See
 * src/lib/session-policy.ts for the durations and the reasoning.
 */
export async function getCurrentUser(policy: SessionPolicy = DEFAULT_POLICY) {
  const supabase = createSupabaseServerClient();
  // getUser() validates against the auth server; getSession() only
  // reads the cookie. Identity comes from the former, and the token is
  // only decoded afterwards, so a forged cookie is rejected before any
  // claim in it is believed.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const sessionId = sessionIdFromAccessToken(sessionData?.session?.access_token);
  if (!sessionId) {
    // No session id means we cannot age the session, so we cannot
    // enforce the policy. Old tokens issued before this claim existed
    // are the realistic cause, and they are precisely the oldest
    // sessions in circulation.
    return null;
  }

  const verdict = evaluateSession(await sessionLifetime(sessionId), policy);
  if (!verdict.valid) {
    console.warn('[auth] session_expired', { reason: verdict.reason, userId: data.user.id });
    return null;
  }

  return data.user;
}

/** Same as getCurrentUser, under the short admin time-box. */
export async function getCurrentAdminUser() {
  return getCurrentUser({ maxAgeMs: ADMIN_SESSION_MAX_AGE_MS });
}

const DEFAULT_POLICY: SessionPolicy = {
  maxAgeMs: SESSION_MAX_AGE_MS,
  maxIdleMs: SESSION_MAX_IDLE_MS
};

/**
 * The session's timestamps, read through a SECURITY DEFINER function
 * because auth.sessions is not exposed through PostgREST.
 *
 * A lookup that fails returns nulls, which evaluateSession treats as an
 * unknown session and refuses. That is the safe direction: the row is
 * missing when the user signed out or the session was revoked.
 */
async function sessionLifetime(sessionId: string): Promise<SessionLifetime> {
  const { data, error } = await supabaseService().rpc('auth_session_lifetime', {
    p_session_id: sessionId
  });
  if (error) {
    console.error('[auth] session_lifetime_unreadable', { error: error.message });
    return { createdAt: null, refreshedAt: null };
  }
  const row = (data as { created_at: string | null; refreshed_at: string | null }[] | null)?.[0];
  if (!row) return { createdAt: null, refreshedAt: null };
  return {
    createdAt: row.created_at ? new Date(row.created_at) : null,
    refreshedAt: row.refreshed_at ? new Date(row.refreshed_at) : null
  };
}

/**
 * Returns the org id stamped in `app_metadata.organization_id`. The
 * onboarding flow writes this once, then it travels in every JWT and
 * powers Postgres RLS.
 */
export function organizationIdFromUser(user: { app_metadata: Record<string, unknown> | null }): string | null {
  const meta = user.app_metadata ?? {};
  const id = (meta as { organization_id?: unknown }).organization_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
