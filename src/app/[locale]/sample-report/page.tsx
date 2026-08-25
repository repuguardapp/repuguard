import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, FileWarning, Info, ScrollText } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { SampleReportLocaleSwitcher } from '@/components/SampleReportLocaleSwitcher';
import { TrustBadges } from '@/components/TrustBadges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buildHreflangAlternates } from '@/lib/hreflang';
import { getSampleSnapshot } from '@/lib/sample-report-snapshot';

interface PageProps {
  params: { locale: string };
}

/**
 * Public, no-auth, no-friction sample audit report.
 *
 * Ethical contract — every finding rendered on this page is the
 * verbatim output of LexyFlow's REAL Multi-Pass audit pipeline, run
 * against a real public source document whose URL is linked in the
 * provenance card at the top. No findings are hand-edited. No org
 * names are invented. No risk scores are tuned for marketing.
 *
 * When the snapshot has not yet been generated (initial post-deploy
 * state, or between regenerations), the page renders a transparent
 * "sample is being regenerated" panel pointing the visitor to
 * /audit so they can run their own audit on their own document.
 * Nothing fabricated is ever shown in place of a real result.
 *
 * Regeneration:
 *   npm run regenerate:sample-report
 *   (see scripts/regenerate-sample-report.ts)
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
  const snapshot = getSampleSnapshot();

  // JSON-LD — only emit when we have a real snapshot to describe.
  // Marking up a "regenerating" placeholder as Article + Product
  // would be misleading to search engines.
  const jsonLd = snapshot
    ? {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Article',
            headline: t('metaTitle'),
            description: t('metaDescription'),
            datePublished: snapshot.audit.generatedAt,
            citation: { '@type': 'CreativeWork', url: snapshot.source.url, name: snapshot.source.name },
            author: { '@type': 'Organization', name: 'LexyFlow' },
            publisher: { '@type': 'Organization', name: 'LexyFlow' },
            inLanguage: locale
          },
          {
            '@type': 'Product',
            name: 'LexyFlow Compliance Audit',
            description: 'Automated audit of any privacy policy or DPA against GDPR, EU AI Act, and the six GCC data-protection regulations.',
            brand: { '@type': 'Brand', name: 'LexyFlow' },
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR', availability: 'https://schema.org/InStock' }
          }
        ]
      }
    : null;

  return (
    <>
      {jsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      )}

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

        {snapshot ? (
          <RealSnapshot snapshot={snapshot} locale={locale} tReport={tReport} t={t} />
        ) : (
          <RegeneratingPlaceholder locale={locale} t={t} />
        )}
      </div>
    </>
  );
}

interface SnapshotProps {
  snapshot: NonNullable<ReturnType<typeof getSampleSnapshot>>;
  locale: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tReport: any;
}

function RealSnapshot({ snapshot, locale, t, tReport }: SnapshotProps) {
  const { source, audit } = snapshot;
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const retrievedDate = dateFormatter.format(new Date(source.retrievedAt));
  const auditDate = dateFormatter.format(new Date(audit.generatedAt));

  return (
    <>
      <header className="mt-8 grid gap-3">
        <Badge variant="outline" className="w-fit">{t('badge')}</Badge>
        <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
          {t('title', { org: source.name })}
        </h1>
        <p className="text-pretty text-muted-foreground">
          {t('subtitle', {
            seconds: audit.durationSeconds,
            count: audit.frameworks.length,
            score: audit.riskScore
          })}
        </p>
      </header>

      {/* Provenance card — the single most important UX element on
          this page. Tells every visitor exactly what was audited,
          when, with which models, and links them to the source so
          they can verify our findings against the original text
          themselves. This is what makes the page a sample REPORT
          rather than marketing copy. */}
      <Card className="mt-6 border-dashed">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-muted-foreground" aria-hidden />
            <CardTitle className="text-sm">{t('provenanceTitle')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="grid gap-1 text-xs text-muted-foreground">
          <p>
            <strong className="text-foreground">{t('provenanceSource')}:</strong>{' '}
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              {source.name}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </p>
          <p>
            <strong className="text-foreground">{t('provenanceLicense')}:</strong> {source.license}
          </p>
          <p>
            <strong className="text-foreground">{t('provenanceRetrieved')}:</strong> {retrievedDate} ({source.charCount.toLocaleString(locale)} {t('provenanceChars')})
          </p>
          <p>
            <strong className="text-foreground">{t('provenanceAuditDate')}:</strong> {auditDate}
          </p>
          <p>
            <strong className="text-foreground">{t('provenanceModels')}:</strong> {audit.anthropicModel} · {audit.openaiModel}
          </p>
        </CardContent>
      </Card>

      <section className="mt-10 grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t('findings')}
        </h2>
        {audit.findings.map((f, i) => (
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
              {f.evidence ? (
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('evidence')}
                  </div>
                  <blockquote className="mt-1 border-s-2 border-muted-foreground/30 ps-3 text-pretty italic">
                    “{f.evidence}”
                  </blockquote>
                </div>
              ) : null}
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

      <section className="mt-12">
        <TrustBadges locale={locale} />
      </section>

      <section className="mt-8 rounded-lg border bg-muted/40 p-6 text-center">
        <p className="text-pretty">{t('footerBody')}</p>
        <Button asChild size="lg" className="mt-4">
          <Link href="/audit">{t('footerCta')}</Link>
        </Button>
      </section>
    </>
  );
}

interface PlaceholderProps {
  locale: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}

function RegeneratingPlaceholder({ locale, t }: PlaceholderProps) {
  return (
    <>
      <header className="mt-8 grid gap-3">
        <Badge variant="outline" className="w-fit">{t('badge')}</Badge>
        <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
          {t('regeneratingTitle')}
        </h1>
      </header>

      <Card className="mt-6 border-dashed bg-muted/30">
        <CardContent className="grid gap-3 pt-6 text-sm">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="space-y-2">
              <p className="text-pretty">{t('regeneratingBody')}</p>
              <p className="text-pretty text-xs text-muted-foreground">
                {t('regeneratingEthics')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="mt-12">
        <TrustBadges locale={locale} />
      </section>

      <section className="mt-8 rounded-lg border bg-muted/40 p-6 text-center">
        <p className="text-pretty">{t('regeneratingCtaBody')}</p>
        <Button asChild size="lg" className="mt-4">
          <Link href="/audit">{t('footerCta')}</Link>
        </Button>
      </section>
    </>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'critical') return <AlertTriangle className="mt-1 h-5 w-5 text-destructive" />;
  if (severity === 'high')     return <FileWarning className="mt-1 h-5 w-5 text-orange-500" />;
  return <CheckCircle2 className="mt-1 h-5 w-5 text-muted-foreground" />;
}
