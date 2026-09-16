import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buildHreflangAlternates } from '@/lib/hreflang';
import { SUB_PROCESSORS } from '@/lib/sub-processors';

/**
 * Public sub-processor register.
 *
 * Read by procurement teams doing vendor-risk review, in whichever
 * country the prospect is buying from — so it is translated like every
 * other public page, including what each provider does and where it
 * sits. Provider names, legal entity names, certifications and transfer
 * mechanisms stay as they are: those are proper nouns and instrument
 * names, and a translated "SOC 2 Type II" would be wrong.
 */

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps) {
  unstable_setRequestLocale(params.locale);
  const t = await getTranslations({ locale: params.locale, namespace: 'integrations' });
  const alternates = await buildHreflangAlternates('/integrations');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical: `/${params.locale}/integrations`, languages: alternates }
  };
}

export default async function IntegrationsPage({ params: { locale } }: PageProps) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations('integrations');
  const sp = await getTranslations('subProcessors');

  return (
    <div className="mx-auto max-w-5xl py-16">
      <header className="grid gap-3">
        <Badge variant="outline" className="w-fit">{t('badge')}</Badge>
        <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          {t('title')}
        </h1>
        <p className="max-w-3xl text-pretty text-lg text-muted-foreground">{t('lead')}</p>
        <p className="text-sm text-muted-foreground">
          {t('seeAlso')}{' '}
          <a href={`/${locale}/privacy`} className="underline underline-offset-2">
            {t('linkPrivacy')}
          </a>{' '}
          ·{' '}
          <a href={`/${locale}/dpa`} className="underline underline-offset-2">
            {t('linkDpa')}
          </a>{' '}
          ·{' '}
          <a href={`/${locale}/terms`} className="underline underline-offset-2">
            {t('linkTerms')}
          </a>
        </p>
      </header>

      <section className="mt-12 rounded-lg border bg-muted/40 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          <span className="text-sm font-medium">{t('zkTitle')}</span>
        </div>
        <p className="mt-2 text-pretty text-sm text-muted-foreground">{t('zkBody')}</p>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-2">
        {SUB_PROCESSORS.map((processor) => (
          <Card key={processor.id} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">{processor.name}</CardTitle>
                  <CardDescription>
                    {sp(`${processor.id}.role`)} ·{' '}
                    <span className="font-mono text-xs">{processor.legalName}</span>
                  </CardDescription>
                </div>
                <a
                  href={processor.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={t('websiteOf', { name: processor.name })}
                >
                  <ArrowUpRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
                </a>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4 text-sm">
              <p className="text-pretty text-muted-foreground">{sp(`${processor.id}.purpose`)}</p>

              <DetailRow label={t('labelRegion')}>{sp(`${processor.id}.region`)}</DetailRow>
              <DetailRow label={t('labelData')}>
                <div className="flex flex-wrap gap-1">
                  {processor.dataCategories.map((category) => (
                    <Badge key={category} variant="secondary" className="text-xs">
                      {sp(`category.${category}`)}
                    </Badge>
                  ))}
                </div>
              </DetailRow>
              <DetailRow label={t('labelCertifications')}>
                <div className="flex flex-wrap gap-1">
                  {processor.certifications.map((certification) => (
                    <Badge key={certification} variant="outline" className="text-xs">
                      {certification}
                    </Badge>
                  ))}
                </div>
              </DetailRow>
              {processor.transferMechanism && (
                <DetailRow label={t('labelTransfers')}>{processor.transferMechanism}</DetailRow>
              )}
              {processor.dpaUrl && (
                <DetailRow label={t('labelDpa')}>
                  <a
                    href={processor.dpaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    {t('providerDpa')}
                  </a>
                </DetailRow>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="mt-12 rounded-lg border bg-muted/30 p-6 text-sm text-muted-foreground">
        <p>{t('noticeBody')}</p>
        <p className="mt-2">
          {t('questions')}{' '}
          <a href="mailto:legal@lexyflow.com" className="underline underline-offset-2">
            legal@lexyflow.com
          </a>
        </p>
      </section>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}
