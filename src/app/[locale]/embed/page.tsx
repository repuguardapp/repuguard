import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowRight, Code2, Eye, Gauge } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buildHreflangAlternates } from '@/lib/hreflang';
import { anonymousDailyCap } from '@/lib/anonymous-quota';
import { appUrl } from '@/lib/app-url';

/**
 * The page that tells anyone the widget exists.
 *
 * /embed/audit has worked since it was built and was documented in
 * exactly one place: a reference inside the audit page's own source.
 * Not on /integrations, not in /docs, nowhere a stranger could find
 * it. Built, verified, never surfaced — the same pattern as the vendor
 * tables, the free trial, the share links and the inbound pipeline.
 *
 * WHY IT IS WORTH A PAGE
 *
 * It is the only acquisition channel on the operator's list that
 * produces inbound links without anybody prospecting: a site that
 * embeds this links back to us. That is the exact currency the crawl
 * budget is short of — 427 URLs discovered and never fetched, on a
 * domain with essentially no external links.
 *
 * WHY IT COULD NOT BE PUBLISHED UNTIL NOW
 *
 * The widget creates audits under the anonymous organisation, which is
 * unauthenticated and runs a model we pay for. The only ceiling was
 * ORG_LIMIT — 50/day, shared by every embedder at once, and held in a
 * Map inside one warm function instance. So one site could exhaust the
 * allowance for all of them, and the cap did not survive across
 * instances in any case. Publishing "copy this snippet" against that
 * was an unbounded invitation. Migration 0053 replaced it with a
 * counter in the database; this page only exists because that does.
 *
 * The number below is read from the same source the API enforces, so
 * the page cannot promise an allowance the server does not honour.
 */

export const revalidate = 3600;

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'embed' });
  return {
    title: t('metaTitle'),
    description: t('lead'),
    alternates: {
      canonical: `/${params.locale}/embed`,
      languages: await buildHreflangAlternates('/embed')
    },
    robots: { index: true, follow: true }
  };
}

export default async function EmbedPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('embed');

  const src = `${appUrl()}/embed/audit`;
  const snippet = `<iframe src="${src}" width="100%" height="720" style="border:0" loading="lazy" title="LexyFlow"></iframe>`;

  return (
    <div className="mx-auto grid max-w-3xl gap-8 px-4 py-16 md:px-0">
      <header className="grid gap-3">
        <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          {t('title')}
        </h1>
        <p className="text-pretty text-lg text-muted-foreground">{t('lead')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Code2 className="h-4 w-4" aria-hidden />
            {t('snippetLabel')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* dir="ltr" even on the Arabic page: this is code, and an RTL
              run would reorder the attributes on screen into something
              that no longer pastes back as valid HTML. */}
          <pre
            dir="ltr"
            className="overflow-x-auto rounded-md border bg-muted/50 p-4 text-xs leading-relaxed"
          >
            <code>{snippet}</code>
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-4 w-4" aria-hidden />
            {t('limitsTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* The number comes from anonymousDailyCap(), the same
              function the API enforces, so this page cannot advertise
              an allowance the server will refuse. */}
          <p className="text-pretty text-sm text-muted-foreground">
            {t('limits', { cap: anonymousDailyCap() })}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye className="h-4 w-4" aria-hidden />
            {t('publicTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Said plainly and before anybody embeds it. Migration 0052
              made anonymous results readable by anyone holding the
              UUID — that is what makes the widget work without an
              account, and a site owner is entitled to know it before
              putting the thing in front of their visitors. */}
          <p className="text-pretty text-sm text-muted-foreground">{t('public')}</p>
        </CardContent>
      </Card>

      <Link
        href="/observatory"
        className="inline-flex w-fit items-center gap-1.5 text-sm underline underline-offset-4"
      >
        {t('sourceLabel')}
        <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
      </Link>
    </div>
  );
}
