import { ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FRAMEWORKS, frameworkById, type FrameworkId } from '@/lib/legal-frameworks';
import { NATIVE_LOCALE_CODES } from '@/i18n/locales';
import { buildHreflangAlternates } from '@/lib/hreflang';
import { frameworkParams, frameworkPairKey, relatedFrameworks } from '@/lib/seo-routes';

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
 *   • JSON-LD Article + Product schema for rich results
 *   • hreflang to every locale variant of this exact framework
 *   • Internal links to GDPR comparison + 3 related frameworks
 *     (drives PageRank into commercial-investigation comparison
 *     pages where conversion intent is higher)
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
  const title = `${framework.name} — Compliance Audit Tool | LexyFlow`;
  const description = `Automated ${framework.name} compliance audit in 60 seconds. Upload any policy, contract, or DPA — get a risk score, ${framework.citationStyle}-level citations, and AI-rewrite suggestions. Free trial, no credit card.`;
  const alternates = await buildHreflangAlternates(`/compliance/${framework.id}`);
  return {
    title,
    description,
    alternates: { canonical: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/${params.locale}/compliance/${framework.id}`, languages: alternates },
    openGraph: { title, description, type: 'article', locale: params.locale },
    twitter: { card: 'summary_large_image', title, description },
    robots: { index: true, follow: true }
  };
}

export default function FrameworkPage({ params }: PageProps) {
  unstable_setRequestLocale(params.locale);
  const framework = frameworkById(params.framework as FrameworkId);
  if (!framework) notFound();

  const related = relatedFrameworks(framework.id, 4);

  // JSON-LD: Article for the page itself + Product for LexyFlow's
  // audit capability. Two graphs concatenated in one <script> so
  // Google reads them as a connected entity.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: `${framework.name} — Compliance Audit`,
        about: { '@type': 'Legislation', name: framework.name, legislationJurisdiction: framework.jurisdiction },
        author: { '@type': 'Organization', name: 'LexyFlow' },
        publisher: { '@type': 'Organization', name: 'LexyFlow' },
        inLanguage: params.locale
      },
      {
        '@type': 'Product',
        name: `${framework.name} Compliance Audit`,
        description: `Automated compliance audit against ${framework.name}`,
        brand: { '@type': 'Brand', name: 'LexyFlow' },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR', availability: 'https://schema.org/InStock' }
      }
    ]
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="mx-auto max-w-3xl py-16 px-4">
        <Badge variant="outline" className="mb-4">{framework.jurisdiction}</Badge>
        <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          {framework.name}
        </h1>
        <p className="mt-4 text-pretty text-lg text-muted-foreground">
          Automated compliance audit against {framework.name}. Upload your privacy policy,
          DPA, or contract — LexyFlow returns a risk score, {framework.citationStyle}-level
          citations to the regulation, and AI-rewrite suggestions for non-compliant clauses.
          In 60 seconds. Free trial, no credit card.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={`/audit?framework=${framework.id}`}>
              Audit your document — free
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/pricing">See pricing</Link>
          </Button>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Jurisdiction</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-base">{framework.jurisdiction}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Supervisory authority</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-base">{framework.authority}</p>
            </CardContent>
          </Card>
        </div>

        <h2 className="mt-16 text-2xl font-semibold tracking-tight">How LexyFlow audits {framework.name}</h2>
        <ul className="mt-4 space-y-3 text-base text-muted-foreground">
          <li className="flex gap-3"><CheckCircle2 className="size-5 shrink-0 text-emerald-600" />Pass-1 — extracts every clause of your document and identifies the ones that touch personal-data processing</li>
          <li className="flex gap-3"><CheckCircle2 className="size-5 shrink-0 text-emerald-600" />Pass-2 — cross-references each clause against {framework.name} {framework.citationStyle}s using a curated rule index built by RegTech counsel</li>
          <li className="flex gap-3"><CheckCircle2 className="size-5 shrink-0 text-emerald-600" />Risk scoring — produces a 0–100 risk score with severity classification per finding (critical / high / medium / low / info)</li>
          <li className="flex gap-3"><CheckCircle2 className="size-5 shrink-0 text-emerald-600" />AI rewrite — for any non-compliant clause, drafts a replacement that respects the original legal register and the rule that flagged it</li>
        </ul>

        <h2 className="mt-16 text-2xl font-semibold tracking-tight">Why LexyFlow vs spreadsheet checklists</h2>
        <ul className="mt-4 space-y-3 text-base text-muted-foreground">
          <li className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-emerald-600" />Documents are AES-256-GCM encrypted at rest with a 32-byte master key held in an EU-hosted secret store. Decryption happens in-memory for the duration of the request only.</li>
          <li className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-emerald-600" />Every plaintext access is logged to a tamper-evident ledger visible to you in /dashboard/security.</li>
          <li className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-emerald-600" />Delete-forever issues a cryptographically signed receipt you can present to a regulator as proof of erasure.</li>
        </ul>

        {related.length > 0 && (
          <>
            <h2 className="mt-16 text-2xl font-semibold tracking-tight">Related compliance frameworks</h2>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {related.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/compare/${frameworkPairKey(framework.id, r.id)}`}
                    className="block rounded-md border bg-card p-4 transition hover:bg-accent"
                  >
                    <div className="text-sm font-medium">{framework.name.split(' — ')[0]} vs {r.name.split(' — ')[0]}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{r.jurisdiction}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-16 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-8 text-center">
          <h3 className="text-xl font-semibold">Audit your first document for free</h3>
          <p className="mt-2 text-sm text-muted-foreground">No credit card. Document deleted after 30 days or on demand.</p>
          <Button asChild size="lg" className="mt-4">
            <Link href={`/audit?framework=${framework.id}`}>
              Start free audit
              <ArrowRight className="ml-2 size-4" />
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
