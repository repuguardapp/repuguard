import 'server-only';

/**
 * Server-side Cloudflare Turnstile verification.
 *
 * Deployed to stop the bot traffic observed hammering
 * /api/auth/magic-link continuously for months (dotted-gmail
 * obfuscation, SMS-gateway "emails", role-based corporate
 * addresses — classic automated signup-endpoint scanning, unrelated
 * to any real prospect). Each bogus attempt costs a Resend send and
 * erodes sender reputation, so this closes it at the source rather
 * than downstream.
 *
 * UNCONFIGURED IS A NO-OP IN DEVELOPMENT AND A REFUSAL IN PRODUCTION.
 *
 * It used to return true whenever the secret was absent, everywhere. That
 * is a bot gate which, if someone forgets one environment variable, is
 * silently not there — and reports success while not being there. The
 * database says what that cost: of 345 accounts, the "professional"
 * segment contains Valve's subpoena inbox, 7-Eleven's ethics line and
 * press desk, three carrier SMS gateways, eleven addresses on one domain
 * and two typo-squatted domains. That is a harvested contact list being
 * injected into the signup form, and it continued through September.
 *
 * Whether the secret was ever set in production, nobody can now say —
 * which is exactly the problem. A gate whose absence is indistinguishable
 * from its presence is not a gate. In production a missing secret is a
 * misconfiguration, so it fails closed and says so loudly; in development
 * and preview it stays a no-op, because that is where the convenience was
 * actually wanted.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp: string | undefined
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV !== 'production') return true;
    // Not a warning. In production this means the signup endpoint has been
    // standing open, and the only way anyone finds out is if it says so.
    console.error('[turnstile] secret_missing_in_production');
    return false;
  }
  if (!token) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (!data.success) {
      console.warn('[turnstile] verify_failed', { errorCodes: data['error-codes'] ?? [] });
    }
    return data.success === true;
  } catch (err) {
    // Fail CLOSED on a verification-service outage — reject rather
    // than silently letting every request bypass the captcha because
    // Cloudflare's endpoint happened to be slow or unreachable.
    console.error('[turnstile] verify_threw', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
