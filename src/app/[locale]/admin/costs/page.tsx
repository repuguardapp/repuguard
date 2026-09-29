import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { AdminSessionExpired } from '@/components/AdminSessionExpired';
import { CostCalculator } from '@/components/CostCalculator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isAdminEmail } from '@/lib/admin';
import { medianPerAudit, usageReport } from '@/lib/model-usage';
import { getCurrentAdminUser, getCurrentUser } from '@/lib/supabase-server';

/**
 * What the models actually cost, and whether the plans cover it.
 *
 * Built because everything said about margin here so far has been
 * arithmetic over my own estimates — "roughly five thousand input tokens
 * an extraction", "an audit is two orders of magnitude above that". Those
 * are guesses with the grammar of figures, and the question they were
 * standing in for is the one that decides whether the pricing works.
 *
 * The token counts on this page are measured, from what the provider
 * reported on each call. The rates are typed in by whoever is reading it,
 * copied from the provider's own page on the day — because this sandbox
 * cannot reach a pricing page, and a per-token rate recalled from memory
 * would be precisely the confident unsourced number that this project
 * exists to keep out of its own tables.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Coûts et marge',
  robots: { index: false, follow: false }
};

const PURPOSE_LABEL: Record<string, string> = {
  extract_legal: 'Extraction des décisions',
  audit_pass1: 'Audit — passe 1',
  audit_localize: 'Audit — localisation',
  audit_rewrite: 'Réécriture de clause',
  reply_classify: 'Classement des réponses',
  other: 'Autre'
};

export default async function CostsPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${params.locale}/login?next=/${params.locale}/admin/costs`);
  if (!isAdminEmail(user.email)) notFound();
  if (!(await getCurrentAdminUser())) return <AdminSessionExpired email={user.email ?? null} />;

  const report = await usageReport(30);
  const median = report ? medianPerAudit(report.perAudit) : null;

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-12 md:px-0">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Coûts et marge</h1>
        <p className="text-sm text-muted-foreground">
          Les jetons sont mesurés — c&apos;est ce que le fournisseur a répondu sur chaque appel. Les
          prix sont saisis par toi, copiés depuis leur page le jour même. Un taux au jeton récité de
          mémoire serait exactement le chiffre sans source que ce tableau existe pour remplacer.
        </p>
      </header>

      {report === null ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6 text-sm">
            Registre illisible. C&apos;est une panne de lecture, pas une absence de dépense.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Consommation mesurée — {report.sinceDays} derniers jours
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {report.rollup.length === 0 ? (
                <p className="text-muted-foreground">
                  Aucun appel enregistré. Le registre a été posé le 29 septembre&nbsp;: tout ce qui
                  précède est invisible pour lui, et il ne prétendra pas le contraire.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {report.rollup.map((row) => (
                    <li
                      key={`${row.purpose}-${row.model}`}
                      className="grid gap-0.5 border-b pb-2 last:border-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>{PURPOSE_LABEL[row.purpose] ?? row.purpose}</span>
                        <span className="font-mono text-xs tabular-nums">
                          {row.calls} appels · {row.inputTokens.toLocaleString('fr')} entrée ·{' '}
                          {row.outputTokens.toLocaleString('fr')} sortie
                        </span>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">{row.model}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Marge par audit</CardTitle>
            </CardHeader>
            <CardContent>
              <CostCalculator
                inputs={{
                  medianInput: median?.inputTokens ?? null,
                  medianOutput: median?.outputTokens ?? null,
                  auditsWithUsage: report.audits.withUsage,
                  auditsTotal: report.audits.total,
                  sinceDays: report.sinceDays
                }}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
