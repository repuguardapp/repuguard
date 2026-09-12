import { ArrowLeft, ArrowRight, ExternalLink, Gavel } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buildHreflangAlternates } from '@/lib/hreflang';
import { auditHrefFor, getPublishedDecision } from '@/lib/legal-decisions';

/**
 * One enforcement decision.
 *
 * The page is built to be worth linking to rather than to be long. It
 * carries our own summary, the facts as a table a compliance officer
 * can scan, the provisions cited, and — prominently, above our own
 * text in reading order on the facts panel — a link to the regulator's
 * original decision. A page that asks to be trusted about the law has
 * to show its working.
 *
 * The disclaimer is not boilerplate. We are a compliance vendor
 * publishing summaries of legal decisions; saying plainly that the
 * original governs where the two differ is both true and the thing
 * that keeps a summary from being read as advice.
 *
 * Internal links run both ways: to the index, and to our existing
 * /compliance/[framework] pages for every framework the decision bears
 * on. Those pages already rank; a fresh, dated, factual page linking
 * into them is exactly the signal they were missing.
 */

export const revalidate = 3600;

interface PageProps {
  params: { locale: string; slug: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const decision = await getPublishedDecision(params.slug, params.locale);
  if (!decision) return { title: 'Not found', robots: { index: false, follow: false } };

  return {
    title: decision.title,
    // The summary is already two to four factual sentences — exactly
    // what a description should be, and written by us.
    description: decision.summary.slice(0, 200),
    alternates: {
      canonical: `/${params.locale}/decisions/${params.slug}`,
      languages: await buildHreflangAlternates(`/decisions/${params.slug}`)
    }
  };
}

export default async function DecisionPage({ params }: PageProps) {
  unstable_setRequestLocale(params.locale);
  const t = await getTranslations('decisions');
  const decision = await getPublishedDecision(params.slug, params.locale);
  if (!decision) notFound();

  const facts: { label: string; value: string }[] = [];
  if (decision.authority) facts.push({ label: t('authority'), value: decision.authority });
  if (decision.decisionDate) facts.push({ label: t('date'), value: decision.decisionDate });
  if (decision.outcome) {
    facts.push({ label: t('outcome'), value: decision.outcome.replace(/_/g, ' ') });
  }
  if (decision.fineEur !== null) {
    facts.push({
      label: t('fine'),
      value: new Intl.NumberFormat(params.locale, {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0
      }).format(decision.fineEur)
    });
  }

  return (
    <article className="mx-auto grid max-w-3xl gap-8 px-4 py-16 md:px-0">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ms-3">
          <Link href="/decisions">
            <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" aria-hidden />
            {t('indexTitle')}
          </Link>
        </Button>
      </div>

      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {decision.frameworks.map((framework) => (
            <Badge key={framework.id} variant="secondary">
              {framework.name}
            </Badge>
          ))}
        </div>
        <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
          {decision.title}
        </h1>
      </header>

      <p className="text-pretty text-lg leading-relaxed">{decision.summary}</p>

      {facts.length > 0 || decision.articles.length > 0 ? (
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <dl className="grid gap-3 sm:grid-cols-2">
              {facts.map((fact) => (
                <div key={fact.label} className="grid gap-0.5">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    {fact.label}
                  </dt>
                  <dd className="text-sm font-medium">{fact.value}</dd>
                </div>
              ))}
            </dl>

            {decision.articles.length > 0 ? (
              <div className="grid gap-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('articles')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {decision.articles.map((article) => (
                    <Badge key={article} variant="outline" className="font-mono text-xs">
                      {article}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-1 border-t pt-4">
              <a
                href={decision.primaryUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex w-fit items-center gap-1.5 text-sm font-medium underline underline-offset-4"
              >
                {t('sourceLabel')} — {decision.sourceName}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* The funnel entrance. A reader who has just seen a regulator
          fine someone under these exact provisions is one click from
          checking their own document, with the framework already
          ticked rather than a form to fill in. */}
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
            href={auditHrefFor(decision)}
            className="inline-flex w-fit items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            {t('cta')}
            <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        </CardContent>
      </Card>

      {decision.frameworks.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="text-sm font-medium">{t('relatedTitle')}</h2>
          <ul className="flex flex-wrap gap-3">
            {decision.frameworks.map((framework) => (
              <li key={framework.id}>
                <Link
                  href={`/compliance/${framework.id}`}
                  className="text-sm underline underline-offset-4"
                >
                  {framework.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="grid gap-2 border-t pt-6 text-xs leading-relaxed text-muted-foreground">
        <p>{t('disclaimer')}</p>
        {decision.sourceLicence ? <p>{decision.sourceLicence}</p> : null}
      </footer>
    </article>
  );
}
