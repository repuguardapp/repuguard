import { ArrowRight, Gavel } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buildHreflangAlternates } from '@/lib/hreflang';
import { listPublishedDecisions } from '@/lib/legal-decisions';

/**
 * Index of published enforcement decisions.
 *
 * The hub of the legal-watch corpus: it links out to every decision
 * page and every decision links back, which is what keeps a growing
 * set of pages reachable in a couple of hops rather than stranded
 * behind a sitemap entry.
 *
 * Revalidated rather than dynamic — the corpus changes a few times a
 * day at most, and a cached page is what a crawler should meet.
 */

export const revalidate = 3600;

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'decisions' });
  return {
    title: t('indexTitle'),
    description: t('indexLead'),
    alternates: {
      canonical: `/${params.locale}/decisions`,
      languages: await buildHreflangAlternates('/decisions')
    }
  };
}

export default async function DecisionsIndexPage({ params }: PageProps) {
  unstable_setRequestLocale(params.locale);
  const t = await getTranslations('decisions');
  const decisions = await listPublishedDecisions(params.locale);

  return (
    <div className="mx-auto grid max-w-3xl gap-8 px-4 py-16 md:px-0">
      <header className="grid gap-3">
        <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
          {t('indexTitle')}
        </h1>
        <p className="text-pretty text-muted-foreground">{t('indexLead')}</p>
      </header>

      {decisions.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">{t('empty')}</CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4">
          {decisions.map((decision) => (
            <li key={decision.id}>
              <Card className="transition-colors hover:border-foreground/20">
                <CardHeader className="gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {decision.authority ? (
                      <Badge variant="secondary">{decision.authority}</Badge>
                    ) : null}
                    {decision.decisionDate ? (
                      <Badge variant="outline">{decision.decisionDate}</Badge>
                    ) : null}
                    {decision.frameworks.map((framework) => (
                      <Badge key={framework.id} variant="outline">
                        {framework.name}
                      </Badge>
                    ))}
                  </div>
                  <CardTitle className="text-base leading-snug">
                    <Link
                      href={`/decisions/${decision.slug}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {decision.title}
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                    {decision.summary}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card className="border-foreground/15 bg-muted/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gavel className="h-4 w-4" aria-hidden />
            {t('ctaTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">{t('ctaBody')}</p>
          <Link
            href="/audit"
            className="inline-flex w-fit items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            {t('cta')}
            <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
