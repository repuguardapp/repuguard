import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { AdminSessionExpired } from '@/components/AdminSessionExpired';
import { DepositButton } from '@/components/DepositButton';
import { OutreachDraft } from '@/components/OutreachDraft';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isAdminEmail } from '@/lib/admin';
import { appUrl } from '@/lib/app-url';
import { observatoryReport } from '@/lib/observatory';
import { getCurrentAdminUser, getCurrentUser } from '@/lib/supabase-server';

/**
 * The distribution console for the study.
 *
 * Two things live here and they are different in kind. The Zenodo deposit
 * is automated except for its last click, because a DOI is permanent.
 * The e-mail drafts are manual except for their writing, because the only
 * way to automate finding the recipients would be to buy or scrape a
 * contact file, which is the thing we deleted and will not rebuild.
 *
 * French, like the rest of the administration: one operator, and he reads
 * French.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Diffusion de l’étude',
  robots: { index: false, follow: false }
};

/** The observation we lead with, and the sentence that goes after it. */
const HEADLINE = {
  id: 'retention_period_stated',
  label: 'indiquent une durée de conservation'
};

export default async function ObservatoryOutreachPage({
  params
}: {
  params: { locale: string };
}) {
  setRequestLocale(params.locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${params.locale}/login?next=/${params.locale}/admin/observatory`);
  if (!isAdminEmail(user.email)) notFound();
  if (!(await getCurrentAdminUser())) return <AdminSessionExpired email={user.email ?? null} />;

  const report = await observatoryReport();
  const origin = appUrl();

  const headline = report?.observations.find((o) => o.id === HEADLINE.id);
  const headlineTotal = headline ? headline.present + headline.notFound + headline.unclear : 0;

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-12 md:px-0">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Diffusion de l’étude</h1>
        <p className="text-sm text-muted-foreground">
          Deux canaux. Zenodo dépose le jeu de données là où on cherche des jeux de données et lui
          donne un DOI citable&nbsp;; les brouillons servent aux dix personnes qu&apos;aucune
          machine ne peut trouver légalement à ta place.
        </p>
      </header>

      {report === null ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6 text-sm">
            Chiffres illisibles. C&apos;est une panne de lecture, pas une absence de données.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Où en est la collecte</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p>
                {report.lookedAt} domaines examinés sur {report.sampleSize}, dont{' '}
                {report.documentsRead} documents réellement lus.
              </p>
              {report.lookedAt < report.sampleSize ? (
                <p className="text-muted-foreground">
                  N&apos;envoie rien avant la fin. Tu n&apos;as qu&apos;un premier e-mail par
                  destinataire, et l&apos;envoyer sur une étude partielle grille le contact et la
                  deuxième édition.
                </p>
              ) : (
                <p>La collecte est complète. L&apos;édition peut être déposée et envoyée.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dépôt Zenodo</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <p className="text-muted-foreground">
                Crée le brouillon et y attache le CSV. La publication reste un geste délibéré&nbsp;:
                un DOI est permanent, et un enregistrement avec un chiffre faux ne se retire pas, il
                se remplace. Un clic par édition trimestrielle — pas un par contact.
              </p>
              <DepositButton />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Brouillon d’e-mail</CardTitle>
            </CardHeader>
            <CardContent>
              <OutreachDraft
                figures={{
                  headlinePercent:
                    headline && headlineTotal > 0
                      ? Math.round((headline.present / headlineTotal) * 100)
                      : null,
                  headlineLabel: HEADLINE.label,
                  documentsRead: report.documentsRead,
                  lookedAt: report.lookedAt,
                  sampleSize: report.sampleSize,
                  refused: report.lookedAt - report.documentsRead,
                  sourceId: report.sourceId,
                  sourceDate: report.sourceDate,
                  observatoryUrl: `${origin}/fr/observatory`,
                  csvUrl: `${origin}/api/observatory/data.csv`
                }}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
