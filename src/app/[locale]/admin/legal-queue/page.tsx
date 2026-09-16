import { ExternalLink, ShieldAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { AdminSessionExpired } from '@/components/AdminSessionExpired';
import { LegalReviewButtons } from '@/components/LegalReviewButtons';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isAdminEmail } from '@/lib/admin';
import { supabaseService } from '@/lib/supabase';
import { getCurrentAdminUser, getCurrentUser } from '@/lib/supabase-server';

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
 * In French, not in seven languages and not in English. It is an
 * internal tool with one operator, and he works in French — putting it
 * through next-intl would mean seven message files maintained for an
 * audience of one, while leaving it in English meant an English panel
 * sitting inside a French site, which is what shipped and what had to
 * be corrected.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'File de validation juridique',
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
  entity: string | null;
  decision_date: string | null;
  articles: string[] | null;
  fine_eur: number | null;
  outcome: string | null;
  summary_en: string | null;
  slug: string | null;
  legal_sources: { name: string; licence: string } | null;
}

export default async function LegalQueuePage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);

  // Two different situations, two different answers.
  //
  // No session at all — including one the twelve-hour admin policy has
  // expired — means sign in. A dead end here sent the operator round
  // three separate diagnostics before we learned the session had
  // simply lapsed, and redirecting leaks nothing: every protected page
  // on the site does the same.
  //
  // A signed-in stranger still gets 404. That is where secrecy
  // actually matters: the existence of this queue is not something a
  // logged-in visitor needs confirmed.
  // Four distinct situations, four distinct answers. Collapsing any of
  // them is what cost three days: a blank page, then a silent bounce to
  // the dashboard, both indistinguishable from an outage.
  //
  //   no session          -> sign in, and come back here afterwards
  //   not on the allowlist-> 404, because the queue's existence is not
  //                          something a signed-in stranger needs
  //   allowlisted but the
  //   admin time-box has
  //   expired             -> say so; /login would only bounce them to
  //                          the dashboard, since the ordinary session
  //                          is still perfectly valid
  //   otherwise           -> the page
  const user = await getCurrentUser();
  if (!user) redirect(`/${params.locale}/login?next=/${params.locale}/admin/legal-queue`);
  if (!isAdminEmail(user.email)) notFound();
  if (!(await getCurrentAdminUser())) return <AdminSessionExpired email={user.email ?? null} />;

  const db = supabaseService();
  const { data, error } = await db
    .from('legal_developments')
    .select(
      'id, primary_url, raw_title, published_at, authority, entity, decision_date, articles, fine_eur, outcome, summary_en, slug, legal_sources(name, licence)'
    )
    .eq('status', 'extracted')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(50);

  const rows = (data ?? []) as unknown as QueueRow[];

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-12 md:px-0">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">File de validation juridique</h1>
        <p className="text-sm text-muted-foreground">
          Approuver déclenche la traduction en six langues et la publication sur lexyflow.com.
          Vérifie chaque fait contre la page du régulateur avant de le faire — à partir de cet
          instant, c&apos;est LexyFlow qui l&apos;affirme, plus un modèle qui l&apos;a produit.
        </p>
      </header>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6 text-sm">File illisible : {error.message}</CardContent>
        </Card>
      ) : null}

      {rows.length === 0 && !error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Rien en attente. Les fiches arrivent ici une fois que la veille a repéré une
            publication et que l&apos;extraction l&apos;a lue — en général dans les douze heures
            suivant la mise en ligne par le régulateur.
          </CardContent>
        </Card>
      ) : null}

      {rows.map((row) => (
        <Card key={row.id}>
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* The name we are about to put in an H1 in seven
                  languages. First badge, and marked in red when it is
                  absent from a sanction, because approving a fine that
                  names nobody is almost always an extraction failure.
                  
                  `order` is deliberately NOT in that list. An EDPB
                  Article 65 decision is an order addressed to a
                  supervisory authority, not to a company: the NOYB
                  cookie-banner case names VRT as the subject of an
                  underlying complaint that has not been decided, and
                  filling `entity` with VRT would have published
                  "VRT — EDPB — order" in seven languages about a
                  broadcaster the EDPB ordered nothing against. A red
                  badge on a legitimate null is worse than no badge: it
                  is what teaches a reviewer to click past the warning
                  that matters. */}
              {row.entity ? (
                <Badge>{row.entity}</Badge>
              ) : row.outcome && ['fine', 'reprimand', 'ban'].includes(row.outcome) ? (
                <Badge variant="destructive">entité non extraite</Badge>
              ) : null}
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
                only context.

                The text itself stays English: it is the pivot the six
                translations are produced from, and approving it is
                approving those six. Labelled as such, because an
                English paragraph inside a French panel otherwise reads
                as one more thing that failed to translate. */}
            <div className="rounded-md border bg-muted/40 p-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Résumé qui serait publié{' '}
                <span className="normal-case tracking-normal">
                  — pivot anglais, les six traductions en sont dérivées
                </span>
              </div>
              <p className="text-sm leading-relaxed">
                {row.summary_en ?? <span className="text-destructive">manquant</span>}
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
                Ouvrir la source primaire
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
