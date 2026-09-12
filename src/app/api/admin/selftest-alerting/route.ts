import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { alertOps } from '@/lib/alert';

/**
 * Prove that the alerting channel actually delivers.
 *
 * Thirteen call sites escalate handled failures through `alertOps`.
 * Every one of them is on a path that already degrades gracefully, so
 * a broken alerting channel looks exactly like a healthy system: no
 * errors, no alerts, nothing to see. That is the failure mode this
 * whole mechanism exists to eliminate, and it would apply to the
 * mechanism itself.
 *
 * So the channel gets a probe. Call shape:
 *   GET /api/admin/selftest-alerting?secret=<ADMIN_SELFTEST_SECRET>
 *
 * It reports the configuration it can see, fires a real alert through
 * the real `alertOps`, then waits for the flush and reports whether
 * delivery succeeded. An `ops.alerting_selftest` issue appearing in
 * Sentry is the confirmation; `delivered: true` here is the same fact
 * observed from our side.
 *
 * Run it after any change to the DSN, to next.config.mjs's Sentry
 * options, or to @sentry/nextjs itself.
 *
 * Never returns the DSN — only whether one is present. The public DSN
 * is not a secret (it ships in the client bundle by design), but the
 * server one has no reason to travel.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provided = url.searchParams.get('secret');
  const expected = process.env.ADMIN_SELFTEST_SECRET;

  // "No secret is configured" and "you sent the wrong secret" are
  // different operational facts and deserve different answers. Saying
  // the endpoint is unconfigured reveals nothing about any secret's
  // value — there isn't one — while collapsing both into 403 leaves
  // the operator guessing at exactly the moment they are trying to
  // find out whether their environment is wired up.
  if (!expected) {
    return NextResponse.json(
      {
        error: 'selftest_not_configured',
        hint: 'ADMIN_SELFTEST_SECRET is not set in this environment. Add it in Vercel and redeploy.'
      },
      { status: 503 }
    );
  }
  if (provided !== expected) {
    // Deliberately says nothing more: past this point the value is a
    // real secret and the response must not become an oracle.
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // getClient() is the ground truth, not the env var: both Sentry
  // configs skip init() when their DSN is missing, so a client here
  // means initialisation genuinely ran in this runtime. An env var set
  // to an empty string, or set after the last build, reads as
  // configured while the SDK is inert.
  const client = Sentry.getClient();
  const config = {
    serverDsnConfigured: Boolean(process.env.SENTRY_DSN),
    publicDsnConfigured: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
    sdkInitialised: client !== undefined,
    environment: process.env.VERCEL_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    sourcemapsUploaded: Boolean(process.env.SENTRY_AUTH_TOKEN)
  };

  if (!config.sdkInitialised) {
    // Not an error — this is the expected answer before the DSN is
    // set, and saying so plainly beats a green tick that means nothing.
    return NextResponse.json({
      ok: false,
      reason: 'sentry_not_initialised',
      hint: config.serverDsnConfigured
        ? 'SENTRY_DSN is present but init() did not run — redeploy so the build picks it up.'
        : 'SENTRY_DSN is not set in this environment.',
      config
    });
  }

  const marker = `selftest-${Date.now()}`;
  alertOps('ops.alerting_selftest', {
    marker,
    note: 'Synthetic alert. If you are reading this in Sentry, the channel works.'
  });

  // alertOps hands its flush to waitUntil, which by design does not
  // block the response. Here we want the opposite: the point of the
  // probe is to report whether delivery actually completed, so we wait
  // for it ourselves. flush() resolves false when the queue did not
  // drain within the timeout.
  let delivered = false;
  let flushError: string | null = null;
  try {
    delivered = await Sentry.flush(5000);
  } catch (err) {
    flushError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    ok: delivered,
    marker,
    delivered,
    flushError,
    expect: `An issue tagged alert:ops.alerting_selftest with marker ${marker}`,
    config
  });
}
