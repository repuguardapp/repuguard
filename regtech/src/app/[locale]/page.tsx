import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { discoverLocales } from '@/i18n/locales';
import { FRAMEWORKS } from '@/lib/legal-frameworks';

interface PageProps {
  params: { locale: string };
}

export default async function HomePage({ params: { locale } }: PageProps) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations('home');
  const tNav = await getTranslations('nav');
  const available = await discoverLocales();

  return (
    <>
      <section className="grid gap-6">
        <span className="text-sm uppercase tracking-wider text-brand-500">
          {t('hero.eyebrow')}
        </span>

        {/*
         * Hero title is allowed to wrap up to ~30% wider than the English copy
         * — that is the empirical headroom German and Japanese need. The
         * `text-balance` utility keeps multi-line headings tidy.
         */}
        <h1 className="text-balance text-4xl md:text-5xl font-bold leading-tight max-w-[26ch] md:max-w-[34ch]">
          {t('hero.title')}
        </h1>

        <p className="text-pretty text-lg text-slate-600 max-w-prose">
          {t('hero.subtitle')}
        </p>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/audit"
            className="btn inline-flex items-center rounded-md bg-brand-500 text-white px-5 py-3 font-medium hover:bg-brand-900"
          >
            {t('hero.cta')}
          </Link>
          <Link
            href="/sample-report"
            className="btn inline-flex items-center rounded-md border border-slate-300 px-5 py-3 font-medium hover:border-slate-400"
          >
            {t('hero.secondaryCta')}
          </Link>
        </div>
      </section>

      <section className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 border-t pt-10">
        <Stat label={t('trust.frameworks')} value={String(FRAMEWORKS.length)} />
        <Stat label={t('trust.languages')} value={'6'} />
        <Stat
          label={t('trust.extraLanguages')}
          value={String(Math.max(0, available.length - 6)) + '+'}
        />
      </section>

      <nav className="sr-only" aria-label="primary">
        <Link href="/pricing">{tNav('pricing')}</Link>
        <Link href="/docs">{tNav('docs')}</Link>
      </nav>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="text-sm text-slate-600 mt-1">{label}</div>
    </div>
  );
}
