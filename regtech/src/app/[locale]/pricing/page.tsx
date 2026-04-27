import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { getLocaleDescriptor } from '@/i18n/locales';
import { CheckoutButton } from '@/components/CheckoutButton';
import { buildHreflangAlternates } from '@/lib/hreflang';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps) {
  unstable_setRequestLocale(params.locale);
  const alternates = await buildHreflangAlternates('/pricing');
  return {
    alternates: { canonical: `/${params.locale}/pricing`, languages: alternates }
  };
}

const PLANS = ['starter', 'pro', 'enterprise'] as const;

export default async function PricingPage({ params: { locale } }: PageProps) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations('pricing');
  const descriptor = getLocaleDescriptor(locale);

  // Indicative monthly amounts in the user's currency. Final price is
  // settled by Stripe at checkout (incl. taxes via automatic_tax).
  const indicativePrices: Record<typeof PLANS[number], Record<string, number>> = {
    starter:    { USD: 49,  EUR: 45,  BRL: 249, JPY: 7_300, GBP: 39 },
    pro:        { USD: 199, EUR: 185, BRL: 990, JPY: 29_500, GBP: 159 },
    enterprise: { USD: 599, EUR: 549, BRL: 2_990, JPY: 89_000, GBP: 479 }
  };

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: descriptor.currency,
    maximumFractionDigits: 0
  });

  return (
    <section className="grid gap-10">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <p className="text-slate-600">{t('subtitle')}</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {PLANS.map((plan) => (
          <article key={plan} className="rounded-2xl border border-slate-200 p-6 grid gap-4">
            <header>
              <h2 className="text-xl font-semibold">{t(`${plan}.name`)}</h2>
              <p className="text-sm text-slate-600">{t(`${plan}.tagline`)}</p>
            </header>
            <div>
              <span className="text-3xl font-semibold tabular-nums">
                {formatter.format(indicativePrices[plan][descriptor.currency] ?? 0)}
              </span>
              <span className="text-sm text-slate-500 ms-1">{t('perMonth')}</span>
            </div>
            <CheckoutButton plan={plan} locale={locale} label={t('checkout')} />
          </article>
        ))}
      </div>
    </section>
  );
}
