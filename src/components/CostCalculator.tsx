'use client';

import { useMemo, useState } from 'react';

/**
 * Margin per audit, from measured tokens and a price the operator
 * supplies.
 *
 * THE RATES ARE TYPED IN, AND THAT IS THE POINT
 *
 * This sandbox cannot reach a pricing page, and quoting a per-token rate
 * from memory on a project whose rule is "no fact without a source and a
 * date" would be the whole problem in miniature: a confident number, in a
 * table, that nobody sourced and everybody then plans against.
 *
 * So the tool does the arithmetic and the operator supplies the price,
 * copied from the provider's own page on the day. The token counts are
 * ours and they are measured; the rates are theirs and they are quoted.
 * Both halves say where they come from.
 */

export interface CostInputs {
  medianInput: number | null;
  medianOutput: number | null;
  auditsWithUsage: number;
  auditsTotal: number;
  sinceDays: number;
}

const FIELD =
  'w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums';

export function CostCalculator({ inputs }: { inputs: CostInputs }) {
  // Per MILLION tokens, because that is the unit every provider quotes.
  const [inputRate, setInputRate] = useState('');
  const [outputRate, setOutputRate] = useState('');
  const [planPrice, setPlanPrice] = useState('');
  const [planAudits, setPlanAudits] = useState('10');

  const result = useMemo(() => {
    const ri = Number(inputRate);
    const ro = Number(outputRate);
    const price = Number(planPrice);
    const audits = Number(planAudits);

    if (
      inputs.medianInput === null ||
      inputs.medianOutput === null ||
      !Number.isFinite(ri) ||
      !Number.isFinite(ro) ||
      inputRate === '' ||
      outputRate === ''
    ) {
      return null;
    }

    const perAudit =
      (inputs.medianInput / 1_000_000) * ri + (inputs.medianOutput / 1_000_000) * ro;

    const planCost = Number.isFinite(audits) && audits > 0 ? perAudit * audits : null;
    const margin =
      planCost !== null && Number.isFinite(price) && planPrice !== '' ? price - planCost : null;

    return { perAudit, planCost, margin, audits };
  }, [inputRate, outputRate, planPrice, planAudits, inputs]);

  const money = (n: number) => n.toFixed(n < 1 ? 4 : 2);

  return (
    <div className="grid gap-4">
      {inputs.medianInput === null ? (
        <p className="text-sm text-muted-foreground">
          Aucun audit mesuré sur les {inputs.sinceDays} derniers jours. Cette page ne calculera rien
          tant qu&apos;il n&apos;y a pas de jetons réels à multiplier — un coût par audit estimé
          serait exactement le chiffre que ce tableau existe pour remplacer.
        </p>
      ) : (
        <p className="text-sm">
          Audit médian mesuré&nbsp;:{' '}
          <span className="font-mono">{inputs.medianInput.toLocaleString('fr')}</span> jetons
          d&apos;entrée,{' '}
          <span className="font-mono">{inputs.medianOutput?.toLocaleString('fr')}</span> de sortie.
          <span className="block text-xs text-muted-foreground">
            Médiane et non moyenne&nbsp;: un audit à treize référentiels sur un contrat de deux
            mégaoctets déplace une moyenne à lui seul. Sur {inputs.auditsWithUsage} audit(s) mesuré(s)
            {inputs.auditsTotal > inputs.auditsWithUsage
              ? ` — ${inputs.auditsTotal - inputs.auditsWithUsage} sans relevé, antérieurs à la mesure`
              : ''}
            .
          </span>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Prix entrée (€ / million de jetons)</span>
          <input
            value={inputRate}
            onChange={(e) => setInputRate(e.target.value)}
            inputMode="decimal"
            className={FIELD}
            placeholder="copié depuis la page de tarifs"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Prix sortie (€ / million de jetons)</span>
          <input
            value={outputRate}
            onChange={(e) => setOutputRate(e.target.value)}
            inputMode="decimal"
            className={FIELD}
            placeholder="copié depuis la page de tarifs"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Prix de l&apos;offre (€ / mois)</span>
          <input
            value={planPrice}
            onChange={(e) => setPlanPrice(e.target.value)}
            inputMode="decimal"
            className={FIELD}
            placeholder="49"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Audits inclus dans l&apos;offre</span>
          <input
            value={planAudits}
            onChange={(e) => setPlanAudits(e.target.value)}
            inputMode="numeric"
            className={FIELD}
          />
        </label>
      </div>

      {result ? (
        <div className="grid gap-2 rounded-md border bg-muted/40 p-4 text-sm">
          <div className="flex justify-between gap-4">
            <span>Coût du modèle par audit</span>
            <span className="font-mono">{money(result.perAudit)} €</span>
          </div>
          {result.planCost !== null ? (
            <div className="flex justify-between gap-4">
              <span>Coût si l&apos;offre est consommée en entier ({result.audits} audits)</span>
              <span className="font-mono">{money(result.planCost)} €</span>
            </div>
          ) : null}
          {result.margin !== null ? (
            <div
              className={`flex justify-between gap-4 border-t pt-2 font-medium ${
                result.margin < 0 ? 'text-destructive' : ''
              }`}
            >
              <span>Marge brute sur l&apos;offre, offre consommée en entier</span>
              <span className="font-mono">{money(result.margin)} €</span>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Marge <em>brute</em>&nbsp;: le modèle seulement. Ni Stripe, ni Vercel, ni Supabase, ni
            Resend. Et le cas calculé est le pire&nbsp;— un abonné qui consomme ses audits jusqu&apos;au
            dernier. Un abonné qui n&apos;en lance aucun coûte zéro.
          </p>
        </div>
      ) : null}
    </div>
  );
}
