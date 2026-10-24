'use client';

import { Landmark } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Create the data.gouv.fr draft.
 *
 * Mirrors DepositButton next door, with one addition that is not
 * cosmetic: every outcome names the platform it reached.
 *
 * `DATAGOUV_BASE` decides whether this touched demo.data.gouv.fr or the
 * live government platform, and the two produce an identical "draft
 * created" message. An operator who cannot tell a rehearsal from a real
 * deposit will eventually treat both as the same, which is how
 * something gets published that nobody meant to publish.
 *
 * Every outcome is a sentence rather than a colour, for the same reason
 * as its neighbour: "the collection is not finished" is the system
 * working, and a red error teaches the reader to click past the one
 * message that is a real failure.
 */
export function DataGouvDepositButton() {
  const [state, setState] = useState<'idle' | 'working'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function deposit() {
    setState('working');
    setMessage(null);
    setLink(null);

    try {
      const res = await fetch('/api/admin/datagouv-deposit', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        base?: string | null;
        created?: boolean;
        reason?: string;
        detail?: string;
        page?: string | null;
        reminder?: string;
      };

      // Named on every branch, including the refusals: a refusal from
      // the sandbox and a refusal from production are different facts.
      const where = body.base ? ` (${body.base})` : '';

      if (body.ok) {
        setMessage(
          body.created
            ? `Brouillon créé${where}. Il est PRIVÉ : relis-le, puis publie-le à la main. Garde private:true sur toute modification, sinon la plateforme le rend public.`
            : `Cette édition est déjà déposée${where}. Rien n’a été créé.`
        );
        setLink(body.page ?? null);
      } else {
        setMessage(`${body.reason ?? body.detail ?? 'Le dépôt n’a pas eu lieu.'}${where}`);
      }
    } catch {
      setMessage('Impossible de joindre notre propre serveur.');
    } finally {
      setState('idle');
    }
  }

  return (
    <div className="grid gap-2">
      <Button
        onClick={deposit}
        disabled={state === 'working'}
        variant="outline"
        className="justify-self-start"
      >
        <Landmark className="me-2 h-4 w-4" aria-hidden />
        {state === 'working' ? 'Dépôt en cours…' : 'Créer le brouillon data.gouv.fr'}
      </Button>
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm underline underline-offset-4"
        >
          Ouvrir le brouillon sur data.gouv.fr
        </a>
      ) : null}
    </div>
  );
}
