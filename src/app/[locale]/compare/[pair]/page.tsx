import { ArrowRight, Scale } from 'lucide-react';
import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buildHreflangAlternates } from '@/lib/hreflang';
import { comparisonParams, parseFrameworkPairSlug } from '@/lib/seo-routes';

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
  const aName = a.name.split(' — ')[0];
  const bName = b.name.split(' — ')[0];
  const title = `${aName} vs ${bName} — Compliance Differences & Audit Tool | LexyFlow`;
  const description = `Compare ${aName} and ${bName} side by side. Jurisdictions, supervisory authorities, citation styles, and a free 60-second audit tool that runs both regulations against your document in parallel.`;
  const alternates = await buildHreflangAlternates(`/compare/${params.pair}`);
  return {
    title,
    description,
    alternates: { canonical: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/${params.locale}/compare/${params.pair}`, languages: alternates },
    openGraph: { title, description, type: 'article', locale: params.locale },
    twitter: { card: 'summary_large_image', title, description },
    robots: { index: true, follow: true }
  };
}

export default function ComparisonPage({ params }: PageProps) {
  unstable_setRequestLocale(params.locale);
  const parsed = parseFrameworkPairSlug(params.pair);
  if (!parsed) notFound();
  const { a, b } = parsed;
  const aName = a.name.split(' — ')[0];
  const bName = b.name.split(' — ')[0];

  // JSON-LD: Article + FAQPage. The FAQ block captures featured-
  // snippet real estate for the "is X different from Y" style
  // queries that drive a meaningful chunk of comparison traffic.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: `${aName} vs ${bName} — Compliance Differences`,
        author: { '@type': 'Organization', name: 'LexyFlow' },
        publisher: { '@type': 'Organization', name: 'LexyFlow' },
        inLanguage: params.locale
      },
      {
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: `What is the difference between ${aName} and ${bName}?`,
            acceptedAnswer: {
              '@type': 'Answer',
              text: `${aName} is enforced in ${a.jurisdiction} by ${a.authority}, while ${bName} is enforced in ${b.jurisdiction} by ${b.authority}. Both use ${a.citationStyle === b.citationStyle ? `${a.citationStyle}-level` : `different (${a.citationStyle} vs ${b.citationStyle})`} citation conventions. LexyFlow can audit a document against both frameworks simultaneously and surface the clauses that fail one but pass the other.`
            }
          },
          {
            '@type': 'Question',
            name: `Do I need to comply with both ${aName} and ${bName}?`,
            acceptedAnswer: {
              '@type': 'Answer',
              text: `If your organization processes personal data of residents in both ${a.jurisdiction} and ${b.jurisdiction}, yes — both frameworks apply concurrently. LexyFlow's dual-framework audit returns a single matrix showing which clauses satisfy one, both, or neither.`
            }
          },
          {
            '@type': 'Question',
            name: `Can LexyFlow audit a document against ${aName} and ${bName} in one pass?`,
            acceptedAnswer: {
              '@type': 'Answer',
              text: `Yes. Select both frameworks at upload time and the audit returns findings cross-referenced to both. The free tier covers one such audit per organization.`
            }
          }
        ]
      }
    ]
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="mx-auto max-w-3xl py-16 px-4">
        <div className="mb-4 flex items-center gap-2">
          <Badge variant="outline">{a.jurisdiction}</Badge>
          <Scale className="size-4 text-muted-foreground" />
          <Badge variant="outline">{b.jurisdiction}</Badge>
        </div>
        <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          {aName} vs {bName}
        </h1>
        <p className="mt-4 text-pretty text-lg text-muted-foreground">
          Side-by-side comparison for compliance officers operating across {a.jurisdiction}
          {' '}and {b.jurisdiction}. Audit any document against both regulations in 60 seconds —
          free, no credit card required.
        </p>

        <div className="mt-8">
          <Button asChild size="lg">
            <Link href={`/audit?framework=${a.id},${b.id}`}>
              Audit against both — free
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>

        <h2 className="mt-16 text-2xl font-semibold tracking-tight">At a glance</h2>
        <div className="mt-4 overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Attribute</th>
                <th className="px-4 py-3 text-left font-medium">{aName}</th>
                <th className="px-4 py-3 text-left font-medium">{bName}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="px-4 py-3 font-medium text-muted-foreground">Jurisdiction</td>
                <td className="px-4 py-3">{a.jurisdiction}</td>
                <td className="px-4 py-3">{b.jurisdiction}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-muted-foreground">Supervisory authority</td>
                <td className="px-4 py-3">{a.authority}</td>
                <td className="px-4 py-3">{b.authority}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-muted-foreground">Citation style</td>
                <td className="px-4 py-3 capitalize">{a.citationStyle}</td>
                <td className="px-4 py-3 capitalize">{b.citationStyle}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium text-muted-foreground">Full regulation name</td>
                <td className="px-4 py-3 text-xs">{a.name}</td>
                <td className="px-4 py-3 text-xs">{b.name}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 className="mt-16 text-2xl font-semibold tracking-tight">Who needs to comply with both?</h2>
        <p className="mt-4 text-base text-muted-foreground">
          Any organization that processes personal data of residents in both {a.jurisdiction} and
          {' '}{b.jurisdiction} faces concurrent obligations. Common profiles: multinationals with
          subsidiaries in each market, B2B SaaS vendors serving customers in both regions, payment
          processors and logistics platforms handling cross-border flows, and any business
          executing data-sharing contracts with counterparties subject to the other regulation.
        </p>

        <h2 className="mt-16 text-2xl font-semibold tracking-tight">Run a dual-framework audit</h2>
        <p className="mt-4 text-base text-muted-foreground">
          LexyFlow accepts both {aName} and {bName} as targets on a single upload. The audit returns
          a single findings matrix showing which clauses pass one regulation, both, or neither —
          with citation-level pointers to the relevant {a.citationStyle === b.citationStyle ? `${a.citationStyle}s` : `articles or sections`} of each text. The
          AI-rewrite feature suggests a single replacement clause that satisfies both.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Deep-dive {aName}</CardTitle>
            </CardHeader>
            <CardContent>
              <Link href={`/compliance/${a.id}`} className="text-sm text-primary hover:underline">
                Full page on {aName} →
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Deep-dive {bName}</CardTitle>
            </CardHeader>
            <CardContent>
              <Link href={`/compliance/${b.id}`} className="text-sm text-primary hover:underline">
                Full page on {bName} →
              </Link>
            </CardContent>
          </Card>
        </div>

        <div className="mt-16 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-8 text-center">
          <h3 className="text-xl font-semibold">Audit your first document against both — free</h3>
          <p className="mt-2 text-sm text-muted-foreground">60 seconds. No credit card. Document deleted after 30 days or on demand.</p>
          <Button asChild size="lg" className="mt-4">
            <Link href={`/audit?framework=${a.id},${b.id}`}>
              Start dual-framework audit
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
