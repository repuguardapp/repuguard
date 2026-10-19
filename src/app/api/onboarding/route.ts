import { NextResponse } from 'next/server';
import { z } from 'zod';
import { captureServerEvent, identifyOrg } from '@/lib/analytics';
import { NATIVE_LOCALE_CODES } from '@/i18n/locales';
import {
  createSupabaseServerClient,
  getCurrentUser,
  organizationIdFromUser
} from '@/lib/supabase-server';
import { supabaseService } from '@/lib/supabase';

export const runtime = 'nodejs';

const Body = z.object({
  name: z.string().trim().min(2).max(120),
  country: z.string().trim().length(2).toUpperCase(),
  uiLocale: z.enum(NATIVE_LOCALE_CODES as unknown as [string, ...string[]]),
  defaultReportLanguage: z.string().trim().min(2).max(10)
});

/**
 * One-shot org bootstrap. Called from /onboarding after the user finished
 * the magic-link flow. Creates the row, stamps the user's app_metadata,
 * REFRESHES THE SESSION so the new claim actually reaches RLS, and
 * returns the org id.
 *
 * Idempotent in a benign way: if the user already has an organization_id
 * we return 200 + the existing id without touching the DB.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const existing = organizationIdFromUser(user);
  if (existing) return NextResponse.json({ organizationId: existing, alreadyOnboarded: true });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: 'invalid_request', detail: String(err) }, { status: 400 });
  }

  const admin = supabaseService();

  const { data: org, error: insertErr } = await admin
    .from('organizations')
    .insert({
      name: body.name,
      country: body.country,
      ui_locale: body.uiLocale,
      default_report_language: body.defaultReportLanguage
    })
    .select('id')
    .single();

  if (insertErr || !org) {
    return NextResponse.json({ error: 'org_create_failed', detail: insertErr?.message }, { status: 500 });
  }

  // Stamp the membership in the user's app_metadata, which is what the
  // RLS policies in 0001_init.sql read.
  const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { ...(user.app_metadata ?? {}), organization_id: org.id }
  });
  if (updateErr) {
    return NextResponse.json({ error: 'metadata_update_failed', detail: updateErr.message }, { status: 500 });
  }

  /**
   * THE COMMENT HERE USED TO SAY "appears in auth.jwt() on the next
   * request". It does not, and that sentence cost us every new
   * customer's first report.
   *
   * `app_metadata` is persisted on the user record. The access token
   * already in the browser is not reissued by writing it: the JWT was
   * minted at sign-in, before this organisation existed, and it keeps
   * the claims it was minted with until it is refreshed — an hour by
   * default.
   *
   * Meanwhile the RLS policy on `audits` reads
   * `auth.jwt()->'app_metadata'->>'organization_id'`. So a brand new
   * account completes onboarding, runs the free audit, is redirected to
   * its own report, and the database refuses the row to the person who
   * just created it. The page renders "Page not found".
   *
   * It is invisible in testing with an existing account, because any
   * session older than an hour has already refreshed.
   *
   * So we refresh here, while we still hold a writable cookie store —
   * this is a Route Handler, where createSupabaseServerClient can
   * actually persist the rotated token.
   *
   * A failure does not fail onboarding: the organisation exists and the
   * stamp is written, so the next natural refresh repairs it. It is
   * reported, because the symptom on the other side is a 404 on a
   * report the customer just paid attention to.
   */
  const { error: refreshErr } = await createSupabaseServerClient().auth.refreshSession();
  if (refreshErr) {
    console.error('[onboarding] session_refresh_failed', {
      organizationId: org.id,
      error: refreshErr.message
    });
  }

  // Analytics — fire-and-forget. identifyOrg() attaches the org id
  // and onboarding traits to the PostHog person profile so every
  // subsequent event from this user is cohort-filterable by country
  // / ui_locale. The signup_completed event is the first step of
  // the conversion funnel — its absence in PostHog means the
  // onboarding write succeeded but analytics dropped, not that the
  // user failed to onboard. Errors inside the analytics module are
  // logged but never bubble up.
  await identifyOrg(user.id, org.id, {
    country: body.country,
    ui_locale: body.uiLocale,
    default_report_language: body.defaultReportLanguage,
    organization_name: body.name
  });
  await captureServerEvent({
    distinctId: user.id,
    event: 'signup_completed',
    properties: {
      organization_id: org.id,
      country: body.country,
      ui_locale: body.uiLocale,
      default_report_language: body.defaultReportLanguage
    }
  });

  // Lifecycle J+0 welcome — fire-and-forget. Only stamp the sent-at
  // timestamp when Resend actually accepted the send, so a cold-
  // start failure will retry on the next signup for the same user
  // (they'd normally not signup twice, but idempotence protects
  // us from double-sends if they do).
  if (user.email) {
    const { sendLifecycleWelcome } = await import('@/lib/email');
    // The very first email anyone receives from us, in the language
    // they just chose in the product.
    const sent = await sendLifecycleWelcome(user.email, body.uiLocale);
    if (sent) {
      await admin
        .from('organizations')
        .update({ lifecycle_welcome_sent_at: new Date().toISOString() })
        .eq('id', org.id);
    }
  }

  return NextResponse.json({ organizationId: org.id, alreadyOnboarded: false });
}
