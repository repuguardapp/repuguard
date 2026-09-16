import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { appUrl } from '@/lib/app-url';
import { buildHreflangAlternates } from '@/lib/hreflang';
import { FRAMEWORKS } from '@/lib/legal-frameworks';
import { authorityName, frameworkLabel, frameworkName } from '@/lib/legal-labels';

/**
 * The hub for /compliance/[framework].
 *
 * It exists because Google told us, in three words, why none of our
 * 329 pages is indexed: "Aucune page d'origine détectée" — no
 * referring page. The header and footer linked to /, /audit,
 * /dashboard, /docs, /dpa, /login, /pricing, /privacy and /terms, and
 * to nothing else. Ninety-one framework pages and 196 comparison pages
 * had no inbound link from anywhere on the site. Their only route in
 * was the sitemap, and a sitemap is a hint, not a path: Google
 * discovers pages by following links, and there were none to follow.
 *
 * So this page is not decoration. It is the edge that connects a
 * disconnected half of the site to the half Google already crawls.
 * From here every framework is one hop, and every comparison two —
 * each framework page already links to four related comparisons.
 */

interface PageProps {
  params: { locale: string };
}

export const revalidate = 86400;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'hubs' });
  return {
    title: t('complianceTitle'),
    description: t('complianceLead'),
    alternates: {
      canonical: `${appUrl()}/${params.locale}/compliance`,
      languages: await buildHreflangAlternates('/compliance')
    },
    robots: { index: true, follow: true }
  };
}

export default async function ComplianceHubPage({ params }: PageProps) {
  unstable_setRequestLocale(params.locale);
  const t = await getTranslations('hubs');

  return (
    <div className="mx-auto grid max-w-4xl gap-8 px-4 py-16 md:px-0">
      <header className="grid gap-3">
        <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
          {t('complianceTitle')}
        </h1>
        <p className="text-pretty text-lg text-muted-foreground">{t('complianceLead')}</p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2">
        {FRAMEWORKS.map((framework) => (
          <li key={framework.id}>
            <Link href={`/compliance/${framework.id}`} className="block h-full">
              <Card className="h-full transition-colors hover:border-foreground/20">
                <CardHeader className="gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{frameworkLabel(framework, params.locale)}</Badge>
                    <Badge variant="outline">{framework.jurisdiction}</Badge>
                  </div>
                  <CardTitle className="text-base leading-snug">
                    {frameworkName(framework, params.locale)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {t('authorityLabel')} — {authorityName(framework.authority, params.locale)}
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      {/* The other two families, so the whole corpus is reachable from
          any one of its hubs rather than only from the footer. */}
      <nav className="flex flex-wrap gap-4 border-t pt-6 text-sm">
        <Link href="/compare" className="inline-flex items-center gap-1.5 underline underline-offset-4">
          {t('seeComparisons')}
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
