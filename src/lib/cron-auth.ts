import 'server-only';
import { isAdminEmail } from './admin';
import { getCurrentAdminUser } from './supabase-server';

/**
 * Who may run a scheduled job.
 *
 * Two callers, and they are not alike.
 *
 * VERCEL CRON presents `Authorization: Bearer <CRON_SECRET>`, injected
 * by the platform from the same environment variable the route reads.
 * That is the machine path and it stays exactly as it was.
 *
 * AN OPERATOR is a signed-in admin, checked against the ADMIN_EMAILS
 * allowlist and the twelve-hour admin session policy. This path is new,
 * and it exists because the old answer — paste the cron secret into a
 * URL bar — was bad in three separate ways that all came due at once:
 *
 *   • CRON_SECRET is stored Sensitive in Vercel, so its value cannot be
 *     read back. The operator who set it cannot use it.
 *   • A secret in a query string travels into logs, browser history and
 *     the Referer header. We already had to patch Sentry for exactly
 *     this after the admin secret reached them in a URL.
 *   • It authenticates a string, not a person. The session path names
 *     who ran the job in the log line.
 *
 * The session path is strictly tighter than the secret path — an
 * allowlisted human with a session under twelve hours old, rather than
 * anyone holding a static string that never expires.
 *
 * With no CRON_SECRET configured the route stays open outside
 * production so Vitest and a local curl can exercise it. In production
 * an unset secret closes the machine path entirely; only the operator
 * path remains.
 */
export async function isCronAuthorized(request: Request): Promise<boolean> {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    if (process.env.NODE_ENV !== 'production') return true;
  } else {
    if (request.headers.get('authorization') === `Bearer ${expected}`) return true;
    // Query-string form kept for the platform's own retries and for
    // scripted callers that cannot set a header. Its value is redacted
    // before any event leaves us — see src/lib/sentry-scrub.ts.
    if (new URL(request.url).searchParams.get('secret') === expected) return true;
  }

  const user = await getCurrentAdminUser();
  return Boolean(user && isAdminEmail(user.email));
}
