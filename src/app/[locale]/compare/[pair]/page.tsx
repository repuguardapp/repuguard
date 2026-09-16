import { ArrowRight, Scale } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buildHreflangAlternates } from '@/lib/hreflang';
import { authorityName, citationLabel, frameworkLabel, frameworkName } from '@/lib/legal-labels';
import { comparisonParams, parseFrameworkPairSlug } from '@/lib/seo-routes';
import { appUrl } from '@/lib/app-url';
import { jsonLdScript } from '@/lib/json-ld';

/**
 * Comparison landing page between two compliance frameworks.
 *
 * URL pattern: /{locale}/compare/{a}-vs-{b}
 *
 * This route owns the commercial-investigation search surface —
 * the queries an in-market compliance officer types when they're
 * scoping a multi-jurisdiction project ("GDPR vs Saudi PDPL
 * differences", "Qatar PDPPL vs UAE PDPL"). These queries convert
 * at 4-6× the rate of pure informational queries.
 *
 * The route is `dynamicParams = false` so only the curated pair
 * list ships — any other slug returns 404 instead of synthesising
 * a thin page Google would penalise.
 *
 * Localised for the reason set out at the top of
 * /compliance/[framework]: thirty-eight pairs × seven locales shipped
 * as the same English page seven times, cross-linked by hreflang as
 * though they were translations of one another.
 *
 * The frameworks are named by their acronym in headings and prose —
 * RGPD, DSGVO, LGPD — and by their full localised title only in the
 * table, where there is room for it. That is also how the queries this
 * page is for are actually typed.
 */

interface PageProps {
  params: { locale: string; pair: string };
}

export const dynamicParams = false;

export function generateStaticParams() {
  return comparisonParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const parsed = parseFrameworkPairSlug(params.pair);
  if (!parsed) return {};
  const { a, b } = parsed;

  const t = await getTranslations({ locale: params.locale, namespace: 'comparePage' });
  const vars = { a: frameworkLabel(a, params.locale), b: frameworkLabel(b, params.locale) };
  const title = t('metaTitle', vars);
  const description = t('metaDescription', vars);
  const alternates = await buildHreflangAlternates(`/compare/${params.pair}`);

  return {
    title,
    description,
    alternates: {
      canonical: `${appUrl()}/${params.locale}/compare/${params.pair}`,
      languages: alternates
    },
    openGraph: { title, description, type: 'article', locale: params.locale },
    twitter: { card: 'summary_large_image', title, description },
    robots: { index: true, follow: true }
  };
}

export default async function ComparisonPage({ params }: PageProps) {
  unstable_setRequestLocale(params.locale);
  const parsed = parseFrameworkPairSlug(params.pair);
  if (!parsed) notFound();
  const { a, b } = parsed;

  const t = await getTranslations('comparePage');
  const aName = frameworkLabel(a, params.locale);
  const bName = frameworkLabel(b, params.locale);

  // Every message that names the two texts or their jurisdictions takes
  // the same bag, so no call site can hand one of them the wrong pair.
  const vars = {
    a: aName,
    b: bName,
    jurisdictionA: a.jurisdiction,
    jurisdictionB: b.jurisdiction,
    authorityA: authorityName(a.authority, params.locale),
    authorityB: authorityName(b.authority, params.locale)
  };

  // JSON-LD: Article + FAQPage. The FAQ block captures featured-
  // snippet real estate for the "is X different from Y" style
  // queries that drive a meaningful chunk of comparison traffic —
  // in the language the page declares, or the snippet is worthless.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: t('schemaHeadline', vars),
        author: { '@type': 'Organization', name: 'LexyFlow' },
        publisher: { '@type': 'Organization', name: 'LexyFlow' },
        inLanguage: params.locale
      },
      {
        '@type': 'FAQPage',
        mainEntity: ([1, 2, 3] as const).map((n) => ({
          '@type': 'Question',
          name: t(`faq${n}Q`, vars),
          acceptedAnswer: { '@type': 'Answer', text: t(`faq${n}A`, vars) }
        }))
      }
    ]
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(jsonLd)} />

      <section className="mx-auto max-w-3xl py-16 px-4">
        <div className="mb-4 flex items-center gap-2">
          <Badge variant="outline">{a.jurisdiction}</Badge>
          <Scale className="size-4 text-muted-foreground" aria-hidden />
          <Badge variant="outline">{b.jurisdiction}</Badge>
        </div>
        <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          {aName} / {bName}
        </h1>
        <p className="mt-4 text-pretty text-lg text-muted-foreground">{t('lead', vars)}</p>

        <div className="mt-8">
          <Button asChild size="lg">
            <Link href={`/audit?framework=${a.id},${b.id}`}>
              {t('ctaPrimary')}
              <ArrowRight className="ms-2 size-4 rtl:-scale-x-100" />
            </Link>
          </Button>
        </div>

        <h2 className="mt-16 text-2xl font-semibold tracking-tight">{t('glanceTitle')}</h2>
        <div className="mt-4 overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t('thAttribute')}</th>
                <th className="px-4 py-3 text-start font-medium">{aName}</th>
                <th className="px-4 py-3 text-start font-medium">{bName}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="px-4 py-3 font-medium text-muted-foreground">
                  {t('rowJurisdiction')}
                </td>
                <td className="px-4 py-3">{a.jurisdiction}</td>
                <td className="px-4 py-3">{b.jurisdiction}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-muted-foreground">{t('rowAuthority')}</td>
                <td className="px-4 py-3">{authorityName(a.authority, params.locale)}</td>
                <td className="px-4 py-3">{authorityName(b.authority, params.locale)}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-muted-foreground">{t('rowCitation')}</td>
                <td className="px-4 py-3">{citationLabel(a.citationStyle, params.locale)}</td>
                <td className="px-4 py-3">{citationLabel(b.citationStyle, params.locale)}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-muted-foreground">{t('rowFullName')}</td>
                <td className="px-4 py-3 text-xs">{frameworkName(a, params.locale)}</td>
                <td className="px-4 py-3 text-xs">{frameworkName(b, params.locale)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 className="mt-16 text-2xl font-semibold tracking-tight">{t('whoTitle')}</h2>
        <p className="mt-4 text-base text-muted-foreground">{t('whoBody', vars)}</p>

        <h2 className="mt-16 text-2xl font-semibold tracking-tight">{t('dualTitle')}</h2>
        <p className="mt-4 text-base text-muted-foreground">{t('dualBody', vars)}</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {[a, b].map((framework) => {
            const label = frameworkLabel(framework, params.locale);
            return (
              <Card key={framework.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    {t('deepDiveTitle', { name: label })}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Link
                    href={`/compliance/${framework.id}`}
                    className="text-sm text-primary hover:underline"
                  >
                    {t('deepDiveLink', { name: label })}
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-16 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-8 text-center">
          <h3 className="text-xl font-semibold">{t('finalTitle')}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{t('finalBody')}</p>
          <Button asChild size="lg" className="mt-4">
            <Link href={`/audit?framework=${a.id},${b.id}`}>
              {t('finalCta')}
              <ArrowRight className="ms-2 size-4 rtl:-scale-x-100" />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
