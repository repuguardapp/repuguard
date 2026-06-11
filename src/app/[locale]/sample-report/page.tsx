import { ArrowLeft, AlertTriangle, CheckCircle2, FileWarning } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { SampleReportLocaleSwitcher } from '@/components/SampleReportLocaleSwitcher';
import { TrustBadges } from '@/components/TrustBadges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buildHreflangAlternates } from '@/lib/hreflang';
import { getSampleFixture } from '@/lib/sample-fixtures';

interface PageProps {
  params: { locale: string };
}

/**
 * Public, no-auth, no-friction sample audit report.
 *
 * This is the asymmetric anchor of the GCC funnel. A DPO landing
 * here from a Saudi search reads a real-looking Qatar PDPPL audit
 * in their native language (Arabic by default, with one-click
 * switching to any of the 7 native locales) without uploading
 * anything — answering the "what does the output actually look
 * like" objection that historically kills mid-funnel B2B
 * conversion before the upload step. SEO-indexable so the page
 * doubles as a top-of-funnel landing surface for the high-intent
 * "qatar pdppl sample audit" / "saudi pdpl audit example" tail.
 */

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'sampleReport' });
  const title = `${t('metaTitle')} | LexyFlow`;
  const description = t('metaDescription');
  const alternates = await buildHreflangAlternates('/sample-report');
  return {
    title,
    description,
    alternates: {
      canonical: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/${params.locale}/sample-report`,
      languages: alternates
    },
    openGraph: { title, description, type: 'article', locale: params.locale },
    twitter: { card: 'summary_large_image', title, description },
    robots: { index: true, follow: true }
  };
}

export default async function SampleReportPage({ params: { locale } }: PageProps) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations('sampleReport');
  const tReport = await getTranslations('report');
  const fixture = getSampleFixture(locale);

  // JSON-LD: Article + Product. The Article anchors the page as a
  // referenceable sample (good for citations from partner blogs,
  // legal newsletters, and Google's knowledge panel); the Product
  // graph tags LexyFlow's free trial offer so the structured-data
  // crawl picks up the "Free, no credit card" signal that the
  // pricing page already advertises.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: t('metaTitle'),
        description: t('metaDescription'),
        about: { '@type': 'Legislation', name: 'Qatar PDPPL (Law No. 13 of 2016)', legislationJurisdiction: 'QA' },
        author: { '@type': 'Organization', name: 'LexyFlow' },
        publisher: { '@type': 'Organization', name: 'LexyFlow' },
        inLanguage: locale
      },
      {
        '@type': 'Product',
        name: 'LexyFlow Qatar PDPPL Audit',
        description: 'Automated audit of any privacy policy or DPA against Qatar PDPPL',
        brand: { '@type': 'Brand', name: 'LexyFlow' },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'QAR', availability: 'https://schema.org/InStock' }
      }
    ]
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-3xl py-12">
        <Button asChild variant="ghost" size="sm" className="-ms-3">
          <Link href="/">
            <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
            {t('back')}
          </Link>
        </Button>

        <div className="mt-4">
          <SampleReportLocaleSwitcher currentLocale={locale} />
        </div>

        <header className="mt-8 grid gap-3">
          <Badge variant="outline" className="w-fit">{t('badge')}</Badge>
          <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
            {t('title', { org: fixture.orgName })}
          </h1>
          <p className="text-pretty text-muted-foreground">
            {t('subtitle', {
              seconds: fixture.seconds,
              count: fixture.frameworkCount,
              score: fixture.riskScore
            })}
          </p>
        </header>

        <section className="mt-10 grid gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t('findings')}
          </h2>
          {fixture.findings.map((f, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="flex items-start gap-3">
                  <SeverityIcon severity={f.severity} />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={f.severity === 'critical' ? 'destructive' : 'secondary'}>
                        {tReport(`severity.${f.severity}`)}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">{f.framework}</span>
                    </div>
                    <CardTitle className="text-base leading-tight">{f.title}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <CardDescription className="text-pretty">{f.body}</CardDescription>
                <div className="rounded-md border bg-muted/50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('recommendation')}
                  </div>
                  <p className="mt-1 text-pretty">{f.recommendation}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        {/* Trust badges below the findings — at this point the
            visitor has SEEN the output quality (the actual
            citations, the actual recommendation tone). The four-
            badge strip then answers "is it safe to send my own
            document". Strategic placement: post-value-demo,
            pre-CTA. */}
        <section className="mt-12">
          <TrustBadges locale={locale} />
        </section>

        <section className="mt-8 rounded-lg border bg-muted/40 p-6 text-center">
          <p className="text-pretty">{t('footerBody')}</p>
          <Button asChild size="lg" className="mt-4">
            <Link href="/audit">{t('footerCta')}</Link>
          </Button>
        </section>
      </div>
    </>
  );
}

function SeverityIcon({ severity }: { severity: 'critical' | 'high' | 'medium' }) {
  if (severity === 'critical') return <AlertTriangle className="mt-1 h-5 w-5 text-destructive" />;
  if (severity === 'high')     return <FileWarning className="mt-1 h-5 w-5 text-orange-500" />;
  return <CheckCircle2 className="mt-1 h-5 w-5 text-muted-foreground" />;
}
