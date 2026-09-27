'use client';

import { BookUp } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Create the Zenodo draft.
 *
 * Every outcome is a sentence rather than a colour. "The collection is at
 * 180 of 300" is the system working and must not look like a failure, or
 * it teaches the reader to click past the one message that is a real one.
 */
export function DepositButton() {
  const [state, setState] = useState<'idle' | 'working'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function deposit() {
    setState('working');
    setMessage(null);
    setLink(null);

    try {
      const res = await fetch('/api/admin/observatory-deposit', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        detail?: string;
        doi?: string | null;
        editUrl?: string | null;
      };

      if (body.ok) {
        setMessage(
          body.doi
            ? `Brouillon créé. DOI réservé : ${body.doi}. Relis les chiffres, puis publie depuis Zenodo.`
            : 'Brouillon créé. Relis les chiffres, puis publie depuis Zenodo.'
        );
        setLink(body.editUrl ?? null);
      } else {
        setMessage(body.reason ?? body.detail ?? 'Le dépôt n’a pas eu lieu.');
      }
    } catch {
      setMessage('Impossible de joindre notre propre serveur.');
    } finally {
      setState('idle');
    }
  }

  return (
    <div className="grid gap-2">
      <Button onClick={deposit} disabled={state === 'working'} className="justify-self-start">
        <BookUp className="me-2 h-4 w-4" aria-hidden />
        {state === 'working' ? 'Dépôt en cours…' : 'Créer le brouillon Zenodo'}
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
          Ouvrir le brouillon sur Zenodo
        </a>
      ) : null}
    </div>
  );
}
