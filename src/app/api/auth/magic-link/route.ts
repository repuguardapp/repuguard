import { NextResponse } from 'next/server';
import { z } from 'zod';
import { alertOps } from '@/lib/alert';
import { clientIpFrom, rateLimit } from '@/lib/rate-limit';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { verifyTurnstileToken } from '@/lib/turnstile';

export const runtime = 'nodejs';

const Body = z.object({
  email: z.string().email().max(254),
  locale: z.string().min(2).max(10).default('en'),
  turnstileToken: z.string().optional()
});

export async function POST(request: Request): Promise<Response> {
  // Outer safety net. Every known throw site below already has its own
  // handling, but this route sits on the critical "first thing a new
  // visitor does" path — a single overlooked throw (a future refactor,
  // an SDK upgrade that changes error shape, an env var typo) must
  // never again surface as Next.js's raw unhandled-exception 500,
  // which the client cannot distinguish from "service unavailable" and
  // renders as the least helpful generic message. Anything that
  // reaches this outer catch is a bug we didn't anticipate — it still
  // gets a clean 503 + a log line with a stack trace to grep for.
  try {
    return await handle(request);
  } catch (err) {
    console.error('[auth/magic-link] unhandled_exception', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}

async function handle(request: Request): Promise<Response> {
  // Tight per-IP cap to thwart enumeration / mailbomb attempts.
  const ip = clientIpFrom(request.headers);
  const limit = rateLimit({ key: `auth:magic:${ip}`, windowMs: 60 * 60 * 1000, max: 10 });
  if (!limit.ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    // Logged (unlike before) so a recurrence of the "every POST body
    // read fails" class of bug shows up in Vercel logs immediately
    // instead of silently returning 400 with nothing to grep for.
    console.error('[auth/magic-link] invalid_request', {
      error: err instanceof Error ? err.message : String(err)
    });
    return NextResponse.json({ error: 'invalid_request', detail: String(err) }, { status: 400 });
  }

  // Bot gate — this endpoint has been observed under sustained
  // automated scanning (dotted-gmail obfuscation, SMS-gateway
  // "emails", role-based corporate addresses — none of it real
  // signups) since well before any known incident, at a steady
  // background rate. verifyTurnstileToken() is a no-op until
  // TURNSTILE_SECRET_KEY is configured in the environment, so this
  // is inert until that's set up. Runs BEFORE the credential checks
  // below so a failed captcha never reaches Supabase or spends a
  // Resend send.
  const captchaOk = await verifyTurnstileToken(body.turnstileToken, ip);
  if (!captchaOk) {
    console.warn('[auth/magic-link] captcha_failed', { ip });
    return NextResponse.json({ error: 'captcha_failed' }, { status: 400 });
  }

  // Hard-fail when the email pipeline is misconfigured server-side.
  // The 503 lets the client render a "service temporarily unavailable"
  // banner instead of a hopeful "check your inbox" — closes the "user
  // waits in the void" failure mode the CEO flagged. These checks are
  // cheap and never leak enumeration data (they're identical for every
  // email).
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error('[auth/magic-link] supabase_env_missing');
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
  if (!process.env.RESEND_API_KEY) {
    console.error('[auth/magic-link] resend_env_missing');
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }

  const origin = request.headers.get('origin') ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  const supabase = createSupabaseServerClient();

  // signInWithOtp can THROW (not just return an error) when Supabase
  // itself is unreachable — paused free-tier project, DNS blip,
  // network partition — or when the configured Send Email Hook
  // rejects the request (bad signature, hook URL down, hook returns
  // non-2xx). Either way Supabase surfaces it as a failed call, not
  // a soft {error} response, in several SDK versions. Catching it
  // lets us return a 503 (which the client maps to a specific
  // "service unavailable" message) and log the reason for triage
  // instead of letting Next.js turn it into an opaque 500.
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: body.email,
      options: {
        emailRedirectTo: `${origin}/api/auth/callback?next=/${body.locale}/dashboard`,
        shouldCreateUser: true,
        // Stamp the locale in the user's metadata so the email hook can
        // render the magic-link mail in the user's language on the very
        // first request — without this, a fresh French signup gets the
        // English fallback because metadata is empty until they finish
        // onboarding.
        data: { locale: body.locale }
      }
    });

    if (error) {
      // Do NOT leak Supabase's error verbatim — that would let an attacker
      // distinguish "email exists" vs "email valid". Always 200, log the
      // detail for ops triage.
      console.error('[auth/magic-link] otp_send_failed', {
        message: error.message,
        status: error.status ?? null,
        code: error.code ?? null
      });
      // The user still sees "check your inbox" (we must not leak
      // whether the address exists), so this is invisible without an
      // explicit alert. This exact branch fired `over_email_send_rate_limit`
      // unnoticed for months while the Supabase auth email hook pointed
      // at a dead deploy URL.
      alertOps('auth.otp_send_failed', {
        message: error.message,
        status: error.status ?? null,
        code: error.code ?? null
      });
    } else {
      console.log('[auth/magic-link] otp_send_queued');
    }
  } catch (err) {
    console.error('[auth/magic-link] otp_threw', {
      error: err instanceof Error ? err.message : String(err),
      cause: err instanceof Error && err.cause ? String(err.cause) : null
    });
    alertOps('auth.otp_threw', {
      error: err instanceof Error ? err.message : String(err),
      cause: err instanceof Error && err.cause ? String(err.cause) : null
    });
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }

  // Always 200 with a generic body so the client UI can show a uniform
  // "check your inbox" regardless of whether the email is registered.
  return NextResponse.json({ ok: true });
}
