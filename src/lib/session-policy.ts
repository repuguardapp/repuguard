/**
 * How long a signed-in session may live.
 *
 * Supabase Auth sessions last INDEFINITELY by default: the access token
 * expires hourly, but the refresh token never does, so a browser
 * silently renews itself for ever. Come back two months later on the
 * same device and you are still signed in.
 *
 * Supabase can enforce a time-box and an inactivity timeout natively —
 * on Pro plans and up. We are on the free plan, so we enforce it
 * ourselves. The policy is not worth twenty-five dollars a month; it is
 * worth writing forty lines.
 *
 * WHY THIS IS NOT OPTIONAL FOR THIS PRODUCT
 *
 * LexyFlow holds compliance reports on documents that contain, in the
 * ones we have seen this week, full names, home addresses, dates of
 * birth and national tax identifiers. An endless session means a lost,
 * borrowed or resold device keeps permanent access to a customer's
 * confidential findings.
 *
 * GDPR Article 32 requires security appropriate to the risk; ISO 27001
 * and SOC 2 both name session timeout explicitly, and any enterprise
 * buyer's security questionnaire asks for it. We sell a tool that
 * finds exactly this class of gap in other people's documents. Having
 * it ourselves is not a rough edge, it is the product contradicting
 * itself.
 *
 * The numbers: magic-link is our only sign-in, so every expiry costs
 * the user an email round trip. That argues for generous limits on the
 * ordinary surface and a short one on admin, where a session decides
 * what LexyFlow publishes in seven languages.
 */

/** Ordinary surfaces: dashboard, reports, audit. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_MAX_IDLE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Admin surfaces. Deliberately short: approving an item in the legal
 * queue turns a model's output into a public statement by LexyFlow, and
 * that is not a decision a two-week-old session on an unattended tablet
 * should be able to take.
 */
export const ADMIN_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface SessionLifetime {
  /** When the session was created — the time-box anchor. */
  createdAt: Date | null;
  /** Last token refresh; null when the session has never been renewed. */
  refreshedAt: Date | null;
}

export interface SessionPolicy {
  maxAgeMs: number;
  /** Omit to skip the inactivity check (admin uses the time-box alone). */
  maxIdleMs?: number;
}

export type SessionVerdict =
  | { valid: true }
  | { valid: false; reason: 'expired_max_age' | 'expired_idle' | 'unknown_session' };

/**
 * Decide whether a session may still be used.
 *
 * Pure, so the policy is testable without a database and without
 * waiting thirty days.
 *
 * An unknown session is REFUSED, not allowed. The lookup fails when the
 * row is gone, and a row is gone because the user signed out or the
 * session was revoked — the two cases where continuing would be worst.
 * Failing open here would quietly undo the whole control.
 */
export function evaluateSession(
  lifetime: SessionLifetime,
  policy: SessionPolicy,
  now: Date = new Date()
): SessionVerdict {
  if (!lifetime.createdAt) return { valid: false, reason: 'unknown_session' };

  if (now.getTime() - lifetime.createdAt.getTime() > policy.maxAgeMs) {
    return { valid: false, reason: 'expired_max_age' };
  }

  if (policy.maxIdleMs !== undefined) {
    // A session that has never been refreshed is only as old as its
    // creation; counting from epoch would expire it instantly.
    const lastSeen = lifetime.refreshedAt ?? lifetime.createdAt;
    if (now.getTime() - lastSeen.getTime() > policy.maxIdleMs) {
      return { valid: false, reason: 'expired_idle' };
    }
  }

  return { valid: true };
}

/**
 * Read the `session_id` claim out of a Supabase access token.
 *
 * The signature is NOT checked here and does not need to be: the caller
 * has already validated the token with the auth server via getUser(),
 * and the claim is used only to look up a row. A forged token fails
 * that earlier check and never reaches this function.
 */
export function sessionIdFromAccessToken(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null;
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const claims = JSON.parse(json) as { session_id?: unknown };
    return typeof claims.session_id === 'string' && claims.session_id.length > 0
      ? claims.session_id
      : null;
  } catch {
    return null;
  }
}
