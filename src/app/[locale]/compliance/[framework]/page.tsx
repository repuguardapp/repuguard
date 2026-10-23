import { ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FRAMEWORKS, frameworkById, type FrameworkId } from '@/lib/legal-frameworks';
import { NATIVE_LOCALE_CODES } from '@/i18n/locales';
import { buildHreflangAlternates } from '@/lib/hreflang';
import { authorityName, frameworkLabel, frameworkName } from '@/lib/legal-labels';
import { frameworkParams, relatedComparisons } from '@/lib/seo-routes';
import { listDecisionsForFramework, type PublishedDecision } from '@/lib/legal-decisions';
import { appUrl } from '@/lib/app-url';
import { jsonLdScript } from '@/lib/json-ld';

/**
 * Programmatic-SEO landing page for a single compliance framework.
 *
 * URL pattern: /{locale}/compliance/{framework_id}
 *
 * Renders as a static page at build time (no DB, no auth, no
 * dynamic data — pure framework metadata + i18n). Indexable,
 * cacheable on Vercel's edge, and zero runtime cost per visit.
 *
 * SEO surface this page owns:
 *   • <title> with framework full name + "audit tool" intent
 *   • Unique meta description per framework × locale combination
 *   • JSON-LD Article + Legislation schema for rich results
 *   • hreflang to every locale variant of this exact framework
 *   • Internal links to GDPR comparison + 3 related frameworks
 *     (drives PageRank into commercial-investigation comparison
 *     pages where conversion intent is higher)
 *
 * WHY THE COPY IS TRANSLATED AND NOT MERELY THE CHROME
 *
 * Thirteen frameworks × seven locales is ninety-one pages, and every
 * one of them shipped in English — the same English, under seven
 * different hreflang tags pointing at each other. That is not a
 * cosmetic defect. It is six near-duplicate pages per framework
 * competing with the /en one, an hreflang cluster telling Google that
 * a French page exists when no French page exists, and a French
 * compliance officer landing on English prose from a French query.
 * The whole point of the route is that it ranks in seven markets.
 *
 * The framework's own name is translated too, via frameworkName():
 * a regulation that has an official French title is called by it.
 */

interface PageProps {
  params: { locale: string; framework: string };
}

export const dynamicParams = false;

export function generateStaticParams() {
  return frameworkParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const framework = frameworkById(params.framework as FrameworkId);
  if (!framework) return {};

  const t = await getTranslations({ locale: params.locale, namespace: 'frameworkPage' });
  const name = frameworkName(framework, params.locale);
  const title = t('metaTitle', { name });
  const description = t('metaDescription', { name });
  const alternates = await buildHreflangAlternates(`/compliance/${framework.id}`);

  return {
    title,
    description,
    alternates: {
      canonical: `${appUrl()}/${params.locale}/compliance/${framework.id}`,
      languages: alternates
    },
    openGraph: { title, description, type: 'article', locale: params.locale },
    twitter: { card: 'summary_large_image', title, description },
    robots: { index: true, follow: true }
  };
}

export default async function FrameworkPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const framework = frameworkById(params.framework as FrameworkId);
  if (!framework) notFound();

  const t = await getTranslations('frameworkPage');
  const name = frameworkName(framework, params.locale);
  // Only pairs that have a page. Ranking by affinity alone emitted
  // thirteen links to comparisons nobody curated — see relatedComparisons.
  const related = relatedComparisons(framework.id, 4);
  // null means the read failed and the page says so; an empty list
  // renders nothing. "No decisions under the GDPR" would be a confident
  // false statement about the law.
  const decisions = await listDecisionsForFramework(framework.id, params.locale);
  const tDecisions = await getTranslations('decisions');

  // JSON-LD: Article for the page itself and Legislation for the
  // regulation it describes, in one <script> so Google reads them as a
  // connected entity.
  //
  // Localised along with the page. `inLanguage` claims this locale, and
  // structured data that contradicts the visible text in the language
  // it declares is the kind of mismatch that costs a rich result.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: t('schemaHeadline', { name }),
        about: {
          '@type': 'Legislation',
          name,
          legislationJurisdiction: framework.jurisdiction
        },
        author: { '@type': 'Organization', name: 'LexyFlow' },
        publisher: { '@type': 'Organization', name: 'LexyFlow' },
        inLanguage: params.locale
      }
      // No Product node here, and not because Google warned about a
      // missing `review` field.
      //
      // This page is a guide to a regulation. Declaring it a Product priced
      // at zero euros was wrong twice over: it is not a product, and the
      // product it gestures at is not free — we have paid plans. Google's
      // warning asked for reviews and an aggregate rating, and the only way
      // to supply those on 637 pages would have been to invent them, which
      // is fabricated review data on a site that sells compliance audits.
      //
      // Removing the claim is the honest way to clear the warning. The
      // Article and Legislation nodes above already describe what this page
      // actually is.
    ]
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(jsonLd)} />

      <section className="mx-auto max-w-3xl py-16 px-4">
        <Badge variant="outline" className="mb-4">{framework.jurisdiction}</Badge>
        <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">{name}</h1>
        <p className="mt-4 text-pretty text-lg text-muted-foreground">{t('lead', { name })}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={`/audit?framework=${framework.id}`}>
              {t('ctaPrimary')}
              <ArrowRight className="ms-2 size-4 rtl:-scale-x-100" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/pricing">{t('ctaPricing')}</Link>
          </Button>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t('jurisdiction')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-base">{framework.jurisdiction}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t('authority')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-base">{authorityName(framework.authority, params.locale)}</p>
            </CardContent>
          </Card>
        </div>

        <h2 className="mt-16 text-2xl font-semibold tracking-tight">{t('howTitle', { name })}</h2>
        <ul className="mt-4 space-y-3 text-base text-muted-foreground">
          {[t('how1'), t('how2', { name }), t('how3'), t('how4')].map((line) => (
            <li key={line} className="flex gap-3">
              <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden />
              {line}
            </li>
          ))}
        </ul>

        <h2 className="mt-16 text-2xl font-semibold tracking-tight">{t('whyTitle')}</h2>
        <ul className="mt-4 space-y-3 text-base text-muted-foreground">
          {[t('why1'), t('why2'), t('why3')].map((line) => (
            <li key={line} className="flex gap-3">
              <ShieldCheck className="size-5 shrink-0 text-emerald-600" aria-hidden />
              {line}
            </li>
          ))}
        </ul>

        {/* The arrow, reversed.

            This route pointed at nothing and was pointed at by every
            decision page. 427 of our URLs sit in Search Console as
            "Discovered – currently not indexed" — found, never fetched —
            because each decision had exactly one internal inbound link,
            from the /decisions hub, on a domain with no external links.

            These pages are prerendered and cheap for a crawler to
            fetch, so a link from here is worth more than a link from a
            page Googlebot is already deferring. Every decision listed
            gains one to three of them.

            It is also the page this route always claimed to be: what
            regulators actually did under these articles, not only what
            the articles say. */}
        {decisions === null ? (
          <p className="mt-16 text-sm text-muted-foreground">{tDecisions('unavailable')}</p>
        ) : decisions.length > 0 ? (
          <>
            <h2 className="mt-16 text-2xl font-semibold tracking-tight">
              {tDecisions('indexTitle')}
            </h2>
            <ul className="mt-4 grid gap-2">
              {decisions.map((d: PublishedDecision) => (
                <li key={d.slug}>
                  <Link
                    href={`/decisions/${d.slug}`}
                    className="block rounded-md border bg-card p-4 transition hover:bg-accent"
                  >
                    <div className="text-sm font-medium">{d.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {[d.authority, d.decisionDate].filter(Boolean).join(' · ')}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/decisions"
              className="mt-4 inline-block text-sm underline underline-offset-4"
            >
              {tDecisions('indexTitle')}
            </Link>
          </>
        ) : null}

        {related.length > 0 && (
          <>
            <h2 className="mt-16 text-2xl font-semibold tracking-tight">{t('relatedTitle')}</h2>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {related.map(({ other: r, slug }) => (
                <li key={r.id}>
                  <Link
                    href={`/compare/${slug}`}
                    className="block rounded-md border bg-card p-4 transition hover:bg-accent"
                  >
                    {/* Acronyms, not full titles: two 60-character legal
                        names in one card is unreadable in any language. */}
                    <div className="text-sm font-medium">
                      {frameworkLabel(framework, params.locale)} / {frameworkLabel(r, params.locale)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{r.jurisdiction}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-16 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-8 text-center">
          <h3 className="text-xl font-semibold">{t('finalTitle')}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{t('finalBody')}</p>
          <Button asChild size="lg" className="mt-4">
            <Link href={`/audit?framework=${framework.id}`}>
              {t('finalCta')}
              <ArrowRight className="ms-2 size-4 rtl:-scale-x-100" />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}

// Pre-export typesafe locale list so generateStaticParams in the
// parent route's [locale] segment cross-multiplies correctly. The
// 7 × 13 = 91 prerendered pages get built once at deploy time.
export const _supportedLocales = NATIVE_LOCALE_CODES;
export const _supportedFrameworks = FRAMEWORKS.map((f) => f.id);
