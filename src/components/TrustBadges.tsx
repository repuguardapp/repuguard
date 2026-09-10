import { Coins, CreditCard, Lock, MapPin, Trash2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

/**
 * Four-badge reassurance strip rendered above the audit upload form.
 *
 * Empirical context — the projection model identified the document-
 * upload step as the single highest drop-off in the funnel: a DPO
 * who is willing to read a marketing page is NOT automatically
 * willing to hand over a confidential DPA to a no-brand SaaS. The
 * trust gate is the single biggest lever we can pull before paid
 * acquisition spend pays off.
 *
 * Each badge addresses one specific objection a compliance officer
 * raises in their head before they upload:
 *
 *   1. "Where does the file go?" → AES-256-GCM at rest.
 *   2. "Who has jurisdiction over the data?" → Hosted in the EU
 *      (Frankfurt). Important for both GDPR Article 46 and KSA
 *      PDPL cross-border transfer logic.
 *   3. "Can I make it disappear?" → 30-day auto-purge + one-click
 *      delete-forever with a signed receipt. The receipt link
 *      goes to /trust where the cryptographic guarantee is
 *      spelled out.
 *   4. "What's the catch?" → No credit card required for the free
 *      audit. Removes the implicit "they'll charge me by surprise"
 *      anxiety that kills mid-funnel B2B conversion.
 *
 * Every badge is clickable to /trust so the curious DPO can deep-
 * dive without leaving the funnel — and the click is observable in
 * PostHog under the auto-captured pageview, surfacing as a separate
 * cohort of "trust-aware" users we can measure conversion against.
 *
 * Badge 4 is audience-dependent. `/audit` redirects anyone who is not
 * signed in, and anyone holding zero credits, before it renders — so
 * the only person who could ever read "free, no credit card" there is
 * someone who has already paid and is spending the credits they bought.
 * Exactly the wrong audience for that reassurance, and confusing at the
 * moment they are about to spend one. Pass `credits` on authenticated
 * surfaces to show the balance instead; leave it undefined on public
 * pages (`/sample-report`), where the objection it answers is real.
 */
export async function TrustBadges({ locale, credits }: { locale: string; credits?: number }) {
  const t = await getTranslations('trustBadges');
  // Reuses the dashboard's existing wording so the balance reads
  // identically wherever the customer sees it.
  const tDashboard = await getTranslations('dashboard');

  const commitment =
    typeof credits === 'number'
      ? { icon: Coins, label: tDashboard('creditsAvailable', { count: credits }), href: '/pricing' }
      : { icon: CreditCard, label: t('noCard'), href: '/pricing' };

  const badges = [
    { icon: Lock,       label: t('encryption'),  href: '/trust#encryption' },
    { icon: MapPin,     label: t('euHosted'),    href: '/trust#hosting' },
    { icon: Trash2,     label: t('deletion'),    href: '/trust#commitments' },
    commitment
  ];

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t('aria')}>
      {badges.map(({ icon: Icon, label, href }) => (
        <li key={label}>
          <Link
            href={href}
            locale={locale}
            className="flex h-full items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs text-card-foreground transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            <span className="text-pretty">{label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
