import 'server-only';
import * as Sentry from '@sentry/nextjs';

/**
 * Escalate a HANDLED failure to Sentry.
 *
 * Sentry catches thrown exceptions. It does not catch this codebase's
 * dominant failure mode: branches that log, degrade gracefully and
 * return 200. That design is deliberate and correct — a webhook that
 * throws gets retried forever, a magic-link route that leaks "this
 * email failed" leaks whether the account exists — but it made six
 * separate production bugs invisible for months (stale webhook URL,
 * mismatched signing secret, wrong price ids, an Invoice field Stripe
 * had moved, a subscription-status race, and an auth email hook still
 * pointing at a dead deploy URL). Every one of them logged. Nobody
 * was watching the logs, because nothing said to look.
 *
 * Call this on the branches where we knowingly swallow a failure, so
 * "graceful for the user" stops meaning "invisible to us".
 *
 * Deliberately does NOT log — call sites keep their existing
 * console.error, which is what makes them greppable in Vercel logs.
 * This is the second channel, not a replacement.
 *
 * No-ops when SENTRY_DSN is unset (Sentry.init is skipped, capture
 * becomes a no-op) — so this is inert until the DSN is configured in
 * the environment.
 */
export function alertOps(event: string, context: Record<string, unknown> = {}): void {
  try {
    Sentry.captureMessage(event, {
      level: 'error',
      tags: { alert: event },
      extra: context
    });
  } catch {
    // Alerting must never be able to break the path it watches — this
    // runs inside a Stripe webhook and the signup route.
  }
}
