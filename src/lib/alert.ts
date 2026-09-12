import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { waitUntil } from '@vercel/functions';

/**
 * How long the serverless invocation may be held open to finish
 * delivering an alert. Comfortably above a healthy round trip to
 * Sentry's ingest endpoint, and short enough that a sick one cannot
 * add a visible pause to anything.
 */
const FLUSH_TIMEOUT_MS = 2000;

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
    return;
  }

  // Capturing only queues the event; the SDK sends it on its own
  // schedule. Normally @sentry/nextjs flushes that queue as part of
  // wrapping the request, but we disabled its Route Handler and App
  // Directory instrumentation in next.config.mjs (it raced with our
  // body reads and produced "Raw body unavailable" 400s on Fluid
  // Compute). That fix took the automatic flush with it.
  //
  // Without this, an alert fired on the line before `return
  // NextResponse.json(...)` races the platform freezing the instance,
  // and loses. The alerts most worth having are exactly the ones
  // raised last: stripe.handler_error, audit.findings_insert_failed,
  // cron.reap_audits_failed. An alerting channel that silently drops
  // the final alert of every request is worse than none, because we
  // would trust it.
  //
  // waitUntil keeps the invocation alive until delivery completes
  // without delaying the response. It is a no-op off Vercel (no
  // request context), where the SDK's own process-exit flush applies.
  try {
    waitUntil(Sentry.flush(FLUSH_TIMEOUT_MS).catch(() => false));
  } catch {
    // Same contract as above: never break the path being watched.
  }
}
