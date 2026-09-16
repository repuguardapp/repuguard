import { ArrowRight, Scale } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { appUrl } from '@/lib/app-url';
import { buildHreflangAlternates } from '@/lib/hreflang';
import { frameworkLabel } from '@/lib/legal-labels';
import { CURATED_PAIRS, parseFrameworkPairSlug } from '@/lib/seo-routes';

/**
 * The hub for /compare/[pair].
 *
 * Same reason as /compliance: 196 comparison pages with no inbound
 * link from anywhere on the site. Google's URL inspection said "Aucune
 * page d'origine détectée" and refused to index them, which is the
 * correct behaviour for a page nothing points at.
 */

interface PageProps {
  params: { locale: string };
}

export const revalidate = 86400;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'hubs' });
  return {
    title: t('compareTitle'),
    description: t('compareLead'),
    alternates: {
      canonical: `${appUrl()}/${params.locale}/compare`,
      languages: await buildHreflangAlternates('/compare')
    },
    robots: { index: true, follow: true }
  };
}

export default async function CompareHubPage({ params }: PageProps) {
  unstable_setRequestLocale(params.locale);
  const t = await getTranslations('hubs');

  const pairs = CURATED_PAIRS.map((slug) => ({ slug, parsed: parseFrameworkPairSlug(slug) })).filter(
    (p): p is { slug: string; parsed: NonNullable<ReturnType<typeof parseFrameworkPairSlug>> } =>
      p.parsed !== null
  );

  return (
    <div className="mx-auto grid max-w-4xl gap-8 px-4 py-16 md:px-0">
      <header className="grid gap-3">
        <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
          {t('compareTitle')}
        </h1>
        <p className="text-pretty text-lg text-muted-foreground">{t('compareLead')}</p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2">
        {pairs.map(({ slug, parsed: { a, b } }) => (
          <li key={slug}>
            <Link href={`/compare/${slug}`} className="block h-full">
              <Card className="h-full transition-colors hover:border-foreground/20">
                <CardContent className="flex flex-wrap items-center gap-2 py-4 text-sm">
                  <span className="font-medium">{frameworkLabel(a, params.locale)}</span>
                  <Scale className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{frameworkLabel(b, params.locale)}</span>
                  <Badge variant="outline" className="ms-auto text-xs">
                    {a.jurisdiction} / {b.jurisdiction}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      <nav className="flex flex-wrap gap-4 border-t pt-6 text-sm">
        <Link href="/compliance" className="inline-flex items-center gap-1.5 underline underline-offset-4">
          {t('seeAll')}
          <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
        </Link>
        <Link href="/decisions" className="inline-flex items-center gap-1.5 underline underline-offset-4">
          {t('seeDecisions')}
          <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
        </Link>
      </nav>
    </div>
  );
}
