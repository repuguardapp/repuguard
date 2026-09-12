import { ShieldCheck } from 'lucide-react';
import { getMessages, getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuditForm } from '@/components/AuditForm';
import { TrustBadges } from '@/components/TrustBadges';
import { buildAuditFormLabels } from '@/lib/audit-labels';
import { FRAMEWORKS, frameworksForCountry } from '@/lib/legal-frameworks';
import { supabaseService } from '@/lib/supabase';
import { getCurrentUser, organizationIdFromUser } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { locale: string };
  searchParams?: { frameworks?: string | string[] };
}

/**
 * Frameworks requested in the URL, validated against the catalogue.
 *
 * This is what makes the decision pages a funnel entrance rather than a
 * reference shelf: a reader who has just seen a regulator fine someone
 * under GDPR Art. 13 arrives here with GDPR already ticked instead of
 * an empty form.
 *
 * Unknown ids are dropped rather than trusted. The value comes from a
 * URL anyone can edit, and a bad id that reached the engine would
 * silently narrow the audit's scope — the 10 Sep failure, arriving by
 * a different door.
 */
function requestedFrameworks(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  const ids = (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => value.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(ids)].filter((id) => FRAMEWORKS.some((f) => f.id === id));
}

export default async function AuditPage({ params: { locale }, searchParams }: PageProps) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations('audit');

  // Tri-state auth gate (CEO-mandated):
  //   1. Not signed in           → /login?next=/{locale}/audit
  //   2. Signed in, 0 credits    → /pricing?reason=no_credits
  //   3. Signed in, has credits  → render the form
  // The embed widget (/embed/audit) keeps the anonymous-org flow for
  // third-party integrations — that path doesn't touch this page.
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/${locale}/login?next=/${locale}/audit`);
  }
  const orgId = organizationIdFromUser(user);
  if (!orgId) {
    redirect(`/${locale}/onboarding`);
  }

  // Read the credit balance directly from the org row. The audit
  // endpoint will atomically re-check via try_consume_audit_credit
  // anyway, but doing it here lets us redirect proactively with a
  // friendly reason banner instead of dropping the user into the
  // form only to see it 402 on submit.
  const { data: org } = await supabaseService()
    .from('organizations')
    .select('credits_remaining,country')
    .eq('id', orgId)
    .maybeSingle();
  const orgRow = org as { credits_remaining?: number; country?: string } | null;
  const credits = orgRow?.credits_remaining ?? 0;
  if (credits <= 0) {
    redirect(`/${locale}/pricing?reason=no_credits`);
  }

  // Pre-select the framework(s) that apply to the org's country so a
  // Saudi org lands with `saudi_pdpl` already checked. Falls back to
  // empty selection (user picks manually) when the country has no
  // framework in our matrix — better than guessing wrong.
  // An explicit request from the URL wins over the country guess: the
  // reader asked for these, we only inferred the others.
  const fromUrl = requestedFrameworks(searchParams?.frameworks);
  const defaultFrameworkIds =
    fromUrl.length > 0
      ? fromUrl
      : orgRow?.country
        ? frameworksForCountry(orgRow.country).map((f) => f.id)
        : [];

  // Pass the full errors namespace as a flat dict so the client
  // component can do labels.errors[code] without a server round-trip.
  const messages = (await getMessages()) as unknown as { errors?: Record<string, string> };
  const errorMessages = messages.errors ?? {};

  return (
    <div className="mx-auto grid max-w-2xl gap-8 px-4 py-16 md:px-0">
      <header className="grid gap-2">
        <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
          {t('upload')}
        </h1>
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          {t('zeroKnowledge')}
        </p>
      </header>

      {/* Trust badges immediately above the form. Placement is
          deliberate — every eye-tracking study on B2B upload flows
          points the same way: the reassurance signal needs to land
          BETWEEN the user reading the hero and them looking at the
          first form field, not below the fold where they'll never
          see it. The four-badge strip is server-rendered, so the
          links are crawlable and contribute internal PageRank to
          /trust. */}
      <TrustBadges locale={locale} credits={credits} />

      <AuditForm
        labels={buildAuditFormLabels(t, errorMessages)}
        frameworks={FRAMEWORKS.map((f) => ({ id: f.id, name: f.name, jurisdiction: f.jurisdiction }))}
        defaultFrameworkIds={defaultFrameworkIds}
        defaultLanguage={locale}
        organizationId={orgId}
        locale={locale}
      />
    </div>
  );
}
