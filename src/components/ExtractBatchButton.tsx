'use client';

import { PlayCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Run one extraction batch, by hand, as the signed-in operator.
 *
 * This exists because the cron is sometimes the wrong tool. When the
 * extractor has just been changed — and it has been changed four times
 * this week, each time after it published something it should not have —
 * the right next step is one batch of eight, read by a human, before the
 * schedule is allowed to touch the other seventy.
 *
 * Until now there was no way to do that. The route accepts a cron secret
 * or an admin session, and the cron secret is stored Sensitive in Vercel,
 * so the person who set it cannot read it back. The only lever was the
 * schedule itself: switch it on and hope to switch it off between two
 * firings. That is not a lever, it is a bet.
 *
 * It calls the same route the platform calls, with the same per-run cap,
 * so what the operator sees is what the schedule would have done — not a
 * separate code path that could drift from it.
 */
export function ExtractBatchButton() {
  const [state, setState] = useState<'idle' | 'working'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setState('working');
    setMessage(null);

    try {
      const res = await fetch('/api/cron/extract-legal', { method: 'POST' });

      if (res.status === 401) {
        setMessage('Session admin refusée. Reconnecte-toi et réessaie.');
        return;
      }

      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        extracted?: number;
        rejected?: number;
        failed?: number;
        note?: string;
      };

      // An abandoned run is the system working — an exhausted balance
      // stops the batch on purpose — so it is a sentence, not an error.
      if (body.ok === false && body.reason) {
        setMessage(`Lot interrompu : ${body.reason}`);
        return;
      }

      if (body.note === 'queue empty') {
        setMessage('Rien à extraire : la file est vide.');
        return;
      }

      setMessage(
        `Lot terminé — ${body.extracted ?? 0} fiche(s) en relecture, ` +
          `${body.rejected ?? 0} rejetée(s) par le filtre, ${body.failed ?? 0} en échec.`
      );
    } catch {
      setMessage('Impossible de joindre notre propre serveur.');
    } finally {
      setState('idle');
    }
  }

  return (
    <div className="grid gap-2">
      <Button
        onClick={run}
        disabled={state === 'working'}
        variant="outline"
        className="justify-self-start"
      >
        <PlayCircle className="me-2 h-4 w-4" aria-hidden />
        {state === 'working' ? 'Extraction en cours…' : 'Lancer un lot d’extraction (8 fiches)'}
      </Button>
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Appelle la même route que la planification, avec le même plafond par lot. Utile quand le
        cron est arrêté et qu’on veut un lot lu par un humain avant de le relancer.
      </p>
    </div>
  );
}
