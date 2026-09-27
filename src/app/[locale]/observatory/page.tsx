import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buildHreflangAlternates } from '@/lib/hreflang';
import { observatoryReport } from '@/lib/observatory';

/**
 * The observatory.
 *
 * The site has 330 programmatic pages and Google indexes five. The
 * diagnosis is not the writing, it is that a new domain with no inbound
 * link does not get crawled — and a generated page never earns one,
 * because nobody cites a page a machine wrote. What earns a link is a
 * number nobody else has, published with a method somebody can check.
 *
 * So this page is not another template. It is one figure, its
 * denominator, the reasons the denominator is not larger, and the method
 * in full. If it earns no external link in sixty days, the SEO channel
 * is dead and we will say so rather than adding pages to it.
 *
 * IT SHOWS NOTHING BEFORE IT HAS SOMETHING
 *
 * The crawl fills over weeks at a few domains an hour, because these are
 * other people's servers. Until it has produced readings the page says
 * so; it does not round a third of a study up to a headline. And when the
 * database cannot be read, it says that too, distinctly — "we could not
 * read our own figures" and "there are no figures" are different
 * sentences.
 */

export const revalidate = 3600;

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  setRequestLocale(params.locale);
  const t = await getTranslations({ locale: params.locale, namespace: 'observatory' });
  return {
    title: t('title'),
    description: t('lead'),
    alternates: {
      canonical: `/${params.locale}/observatory`,
      languages: await buildHreflangAlternates('/observatory')
    }
  };
}

/** The seven, in the order the scan reports them. */
const LABELS: Record<string, string> = {
  retention_period_stated: 'retentionPeriodStated',
  dpo_contact_published: 'dpoContactPublished',
  legal_basis_cited: 'legalBasisCited',
  data_subject_rights_listed: 'dataSubjectRightsListed',
  supervisory_authority_named: 'supervisoryAuthorityNamed',
  international_transfers_addressed: 'internationalTransfersAddressed',
  last_updated_stated: 'lastUpdatedStated'
};

export default async function ObservatoryPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const t = await getTranslations('observatory');
  const tScan = await getTranslations('scan');
  const report = await observatoryReport();

  return (
    <div className="mx-auto grid max-w-3xl gap-8 px-4 py-16 md:px-0">
      <header className="grid gap-3">
        <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
          {t('title')}
        </h1>
        <p className="text-pretty text-muted-foreground">{t('lead')}</p>
      </header>

      {report === null ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {t('unavailable')}
          </CardContent>
        </Card>
      ) : report.lookedAt === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">{t('empty')}</CardContent>
        </Card>
      ) : (
        <>
          {/* Provisional while the crawl is still running, and said in
              the same breath as the first number rather than in a
              footnote underneath it. */}
          {report.lookedAt < report.sampleSize ? (
            <Card className="border-dashed">
              <CardContent className="pt-6 text-sm">
                {t('collecting', { done: report.lookedAt, total: report.sampleSize })}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('readTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <p className="text-muted-foreground">
                {t('readLead', { read: report.documentsRead, lookedAt: report.lookedAt })}
              </p>
              {report.lastReadAt ? (
                <p className="text-xs text-muted-foreground">
                  {t('asOf', { date: report.lastReadAt.slice(0, 10) })}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {report.observations.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('findingsTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <p className="text-sm text-muted-foreground">
                  {t('findingsLead', { read: report.documentsRead })}
                </p>
                <ul className="grid gap-3">
                  {report.observations.map((row) => {
                    const total = row.present + row.notFound + row.unclear;
                    const pct = total > 0 ? Math.round((row.present / total) * 100) : 0;
                    const key = LABELS[row.id];
                    return (
                      <li key={row.id} className="grid gap-1">
                        <div className="flex items-baseline justify-between gap-4">
                          <span className="text-sm">
                            {key ? tScan(`observation.${key}`) : row.id}
                          </span>
                          {/* The count beside the percentage, always. A
                              percentage with no denominator is the shape
                              of a number you cannot check. */}
                          <span className="whitespace-nowrap text-sm tabular-nums">
                            {pct}%{' '}
                            <span className="text-xs text-muted-foreground">
                              ({row.present}/{total})
                            </span>
                          </span>
                        </div>
                        <div
                          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                          role="presentation"
                        >
                          <div className="h-full bg-foreground/70" style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {report.refusals.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('refusalsTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {report.refusals.map((row) => (
                  <Badge key={row.code} variant="outline" className="font-mono text-xs">
                    {row.code} · {row.count}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('methodTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground">
          {/* The sample sentence needs the list id, so it is only shown
              once there is one. A methodology that says "Tranco list
              null" is worse than none: it is a reproducibility claim
              that cannot be acted on. */}
          {report?.sourceId && report.sourceDate ? (
            <p>
              {t('methodSample', {
                sourceId: report.sourceId,
                sourceDate: report.sourceDate,
                total: report.sampleSize
              })}
            </p>
          ) : null}
          <p>{t('methodCrawl')}</p>
          <p>{t('methodObservations')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('limitsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground">
          <p>{t('limitsNoVerdict')}</p>
          <p>{t('limitsSuffix')}</p>
          <p>{t('limitsRefusals')}</p>
        </CardContent>
      </Card>

      {report && report.lookedAt > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('downloadTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p className="text-muted-foreground">{t('downloadLead')}</p>
            <a
              href="/api/observatory/data.csv"
              className="inline-flex items-center gap-1.5 font-medium underline underline-offset-4"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              {t('downloadCta')}
            </a>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
