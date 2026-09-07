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
 * Graceful when unconfigured: returns true (no-op) until
 * TURNSTILE_SECRET_KEY is set in the environment, so local dev and
 * any deploy that hasn't set up Cloudflare yet keep working exactly
 * as before. Once the secret is set, a request WITHOUT a token is
 * rejected — this is what actually turns the captcha on.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp: string | undefined
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
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
