import { Languages } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { NATIVE_LOCALES } from '@/i18n/locales';

/**
 * Sticky language pill row above the sample report.
 *
 * Why a dedicated switcher here rather than relying on the global
 * header language menu: the sample report is the showcase surface
 * for our multilingual + RTL story. A visitor landing on
 * /en/sample-report from a Saudi search needs to be able to flip
 * to /ar with one click — without leaving the page — to SEE the
 * RTL rendering and the native Arabic citations side by side.
 * That comparison IS the marketing pitch.
 *
 * Each pill is a same-route locale switch via the next-intl
 * <Link> component so the URL gets the canonical locale-prefixed
 * path and search engines see the right alternates. The current
 * locale's pill is non-clickable (rendered as a span) so we never
 * emit a self-referential link, which both protects the
 * crawlability budget and gives screen-reader users the right
 * "current page" semantics.
 */
interface Props {
  currentLocale: string;
}

export async function SampleReportLocaleSwitcher({ currentLocale }: Props) {
  const t = await getTranslations('sampleReport');

  return (
    <nav aria-label={t('switcherAria')} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 p-2">
      <Languages className="ms-1 h-4 w-4 text-muted-foreground" aria-hidden />
      <span className="text-xs font-medium text-muted-foreground">{t('switcherLabel')}</span>
      <ul className="flex flex-wrap gap-1">
        {NATIVE_LOCALES.map((locale) => {
          const isCurrent = locale.code === currentLocale;
          const className = isCurrent
            ? 'rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
            : 'rounded-full border bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent';
          return (
            <li key={locale.code}>
              {isCurrent ? (
                <span aria-current="page" className={className}>
                  {locale.endonym}
                </span>
              ) : (
                <Link href="/sample-report" locale={locale.code} className={className}>
                  {locale.endonym}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
