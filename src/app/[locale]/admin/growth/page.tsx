import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { AdminSessionExpired } from '@/components/AdminSessionExpired';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isAdminEmail } from '@/lib/admin';
import { supabaseService } from '@/lib/supabase';
import { getCurrentAdminUser, getCurrentUser } from '@/lib/supabase-server';

/**
 * The one screen that answers "does anyone want this".
 *
 * Built because the instruction is zero manual prospecting: no interviews,
 * no calls, no inbox to read. So the question has to be answered by
 * measurement, and measurement means deciding in advance which number is
 * the answer — otherwise the dashboard becomes a place to find an
 * encouraging figure, which is what a vanity metric is.
 *
 * THE NUMBER IS `audit_completed`.
 *
 * Not sends, not clicks, not replies. A stranger who received one email,
 * came to the site, uploaded their own document and waited for the result
 * has done the thing a customer does. Everything above it in the funnel is
 * diagnostic — it tells you where the machine is failing, not whether the
 * product is wanted.
 *
 * 345 signups meant nothing, and steered months of decisions, because
 * nobody asked what the number was of. This page states what each number
 * is of, on the page, in the words of the thing it measures.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Croissance',
  robots: { index: false, follow: false }
};

interface Row {
  status: string;
  n: number;
}

/**
 * The funnel, in the order a person passes through it.
 *
 * `sent → click → audit_started → audit_completed → replied`. Replies come
 * last deliberately: a reply is a nice signal and a completed audit is a
 *買 signal, and putting replies first would let a week of polite "sounds
 * interesting" answers look like progress.
 */
const STEPS: { kind: string; label: string; meaning: string }[] = [
  { kind: 'sent', label: 'Messages envoyés', meaning: 'remis au fournisseur, pas forcément à la boîte' },
  { kind: 'click', label: 'Clics', meaning: "quelqu'un a choisi d'ouvrir le lien" },
  { kind: 'audit_started', label: 'Audits commencés', meaning: 'document déposé sur le site' },
  { kind: 'audit_completed', label: 'Audits terminés', meaning: "le geste d'un client — c'est le chiffre" },
  { kind: 'replied', label: 'Réponses', meaning: 'agréable, mais ce n’est pas un achat' }
];

export default async function GrowthPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);

  // Same four-way guard as the other admin screens — see the note in
  // admin/ops. French for the same reason: one operator, and he reads it.
  const user = await getCurrentUser();
  if (!user) redirect(`/${params.locale}/login?next=/${params.locale}/admin/growth`);
  if (!isAdminEmail(user.email)) notFound();
  if (!(await getCurrentAdminUser())) return <AdminSessionExpired email={user.email ?? null} />;

  const db = supabaseService();

  const [contacts, sends, events] = await Promise.all([
    db.from('outreach_contacts').select('status'),
    db.from('outreach_sends').select('id', { count: 'exact', head: true }),
    db.from('outreach_events').select('kind, contact_id')
  ]);

  const byStatus = new Map<string, number>();
  for (const row of (contacts.data ?? []) as Row[]) {
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
  }

  // Counted by DISTINCT CONTACT, not by event.
  //
  // One recipient whose corporate mail scanner follows the link four times
  // produces four click rows. Reporting those as four clicks is how 46
  // "confirmed" accounts became 42 sessions used for nothing — the exact
  // measurement error this company has already paid for once.
  const peopleBy = new Map<string, Set<string>>();
  for (const row of (events.data ?? []) as { kind: string; contact_id: string }[]) {
    if (!peopleBy.has(row.kind)) peopleBy.set(row.kind, new Set());
    peopleBy.get(row.kind)!.add(row.contact_id);
  }

  const counts = new Map<string, number>([['sent', sends.count ?? 0]]);
  for (const [kind, people] of peopleBy) counts.set(kind, people.size);

  const contacted = counts.get('sent') ?? 0;
  const completed = counts.get('audit_completed') ?? 0;

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-12 md:px-0">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Croissance</h1>
        <p className="text-sm text-muted-foreground">
          Le seul chiffre qui répond à « est-ce que quelqu’un en veut » est{' '}
          <strong className="text-foreground">audits terminés</strong>. Tout ce qui est au-dessus
          dit où la machine coince, pas si le produit est voulu.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entonnoir — personnes distinctes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {STEPS.map((step) => {
            const n = counts.get(step.kind) ?? 0;
            // The rate is against people contacted, not against the step
            // above. A chain of percentages each computed on the previous
            // one flatters every stage after the first.
            const rate = contacted > 0 ? ((n / contacted) * 100).toFixed(1) : null;
            const decisive = step.kind === 'audit_completed';

            return (
              <div
                key={step.kind}
                className={`grid gap-1 border-b pb-3 last:border-0 last:pb-0 ${
                  decisive ? 'rounded-md border bg-muted/40 p-3' : ''
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={decisive ? 'text-sm font-semibold' : 'text-sm font-medium'}>
                    {step.label}
                  </span>
                  <span className="text-lg tabular-nums">{n}</span>
                  {rate && step.kind !== 'sent' ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {rate} % des contactés
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{step.meaning}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fichier de prospection</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {['new', 'queued', 'sent', 'replied', 'converted', 'unsubscribed', 'bounced'].map((s) => (
            <Badge key={s} variant={s === 'converted' ? 'secondary' : 'outline'}>
              {s}: {byStatus.get(s) ?? 0}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verdict</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {/*
            The thresholds are written into the page, before the data
            arrives, so that a disappointing number cannot be reinterpreted
            as an encouraging one later. This is the whole reason the screen
            exists rather than a SQL query run when we feel like it.
          */}
          {contacted < 200 ? (
            <p className="text-muted-foreground">
              {contacted} contactés. En dessous de 200, aucun chiffre ici ne veut dire quoi que ce
              soit — un audit terminé sur trente est du hasard.
            </p>
          ) : completed >= 6 ? (
            <p>
              <strong>{completed} audits terminés par des inconnus.</strong> Il y a un marché. La
              question suivante est le prix, pas l’intérêt.
            </p>
          ) : completed >= 2 ? (
            <p>
              <strong>{completed} audits terminés.</strong> Signal faible mais réel. Changer de
              cible ou de message avant de changer le produit.
            </p>
          ) : (
            <p>
              <strong>{completed} audit terminé sur {contacted} contactés.</strong> Sur ce volume,
              c’est la réponse : personne ne veut de ceci sous cette forme. C’est un résultat, pas
              un échec — il a coûté deux semaines au lieu de six mois.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
