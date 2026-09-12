import { ExternalLink, ShieldAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { unstable_setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { LegalReviewButtons } from '@/components/LegalReviewButtons';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isAdminEmail } from '@/lib/admin';
import { supabaseService } from '@/lib/supabase';
import { getCurrentAdminUser } from '@/lib/supabase-server';

/**
 * The legal review queue — the only screen the acquisition engine ever
 * asks a human to open.
 *
 * Everything upstream runs itself. This is the editorial gate, and the
 * page is built around one question: does what we are about to publish
 * match the primary source? Hence the layout — our summary and the
 * extracted facts side by side with a prominent link to the
 * regulator's own page, and nothing else competing for attention.
 *
 * English-only on purpose. It is an internal tool for one or two
 * people, and translating it into seven languages would be work that
 * serves nobody.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Legal review queue',
  // An internal queue has no business in an index, and its rows quote
  // material we have not yet cleared for publication.
  robots: { index: false, follow: false }
};

interface QueueRow {
  id: string;
  primary_url: string;
  raw_title: string;
  published_at: string | null;
  authority: string | null;
  decision_date: string | null;
  articles: string[] | null;
  fine_eur: number | null;
  outcome: string | null;
  summary_en: string | null;
  slug: string | null;
  legal_sources: { name: string; licence: string } | null;
}

export default async function LegalQueuePage({ params }: { params: { locale: string } }) {
  unstable_setRequestLocale(params.locale);

  // 404 rather than 403: an internal tool should not confirm it exists
  // to someone who has no business here.
  const user = await getCurrentAdminUser();
  if (!user || !isAdminEmail(user.email)) notFound();

  const db = supabaseService();
  const { data, error } = await db
    .from('legal_developments')
    .select(
      'id, primary_url, raw_title, published_at, authority, decision_date, articles, fine_eur, outcome, summary_en, slug, legal_sources(name, licence)'
    )
    .eq('status', 'extracted')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(50);

  const rows = (data ?? []) as unknown as QueueRow[];

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-12 md:px-0">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Legal review queue</h1>
        <p className="text-sm text-muted-foreground">
          Approving clears an item for translation into six languages and publication on
          lexyflow.com. Check each fact against the regulator&apos;s own page before you do — from
          that moment it is something we say, not something a model produced.
        </p>
      </header>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6 text-sm">Queue unreadable: {error.message}</CardContent>
        </Card>
      ) : null}

      {rows.length === 0 && !error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Nothing waiting. Items appear here once the watcher finds a publication and the
            extractor has read it — normally within twelve hours of a regulator posting.
          </CardContent>
        </Card>
      ) : null}

      {rows.map((row) => (
        <Card key={row.id}>
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {row.authority ? <Badge variant="secondary">{row.authority}</Badge> : null}
              {row.decision_date ? <Badge variant="outline">{row.decision_date}</Badge> : null}
              {row.outcome ? <Badge variant="outline">{row.outcome}</Badge> : null}
              {row.fine_eur !== null ? (
                <Badge variant="outline">
                  {new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(row.fine_eur)}
                </Badge>
              ) : null}
            </div>
            <CardTitle className="text-base leading-snug">{row.raw_title}</CardTitle>
          </CardHeader>

          <CardContent className="grid gap-4">
            {/* What would actually be published. Shown first because it
                is the thing being approved — the raw headline above is
                only context. */}
            <div className="rounded-md border bg-muted/40 p-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Summary we would publish
              </div>
              <p className="text-sm leading-relaxed">
                {row.summary_en ?? <span className="text-destructive">missing</span>}
              </p>
            </div>

            {row.articles && row.articles.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {row.articles.map((article) => (
                  <Badge key={article} variant="outline" className="font-mono text-xs">
                    {article}
                  </Badge>
                ))}
              </div>
            ) : null}

            <div className="grid gap-1 text-sm">
              <a
                href={row.primary_url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 font-medium underline underline-offset-4"
              >
                Open the primary source
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
              {row.legal_sources ? (
                <p className="inline-flex items-start gap-1.5 text-xs text-muted-foreground">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    {row.legal_sources.name} — {row.legal_sources.licence}
                  </span>
                </p>
              ) : null}
              {row.slug ? (
                <p className="font-mono text-xs text-muted-foreground">/decisions/{row.slug}</p>
              ) : null}
            </div>

            <LegalReviewButtons developmentId={row.id} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
