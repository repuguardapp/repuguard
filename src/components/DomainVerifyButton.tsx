'use client';

import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Ask the server to look for the TXT record.
 *
 * "Not found yet" is the expected first answer, not a failure — DNS
 * propagation is measured in minutes to hours, and a visitor who added the
 * record thirty seconds ago has done everything right. So the endpoint
 * answers 200 with `verified: false`, and this component says "not found
 * yet" rather than colouring it as an error.
 *
 * On success the page is refreshed from the server rather than patched in
 * place: whether a page is indexable is decided in its metadata, and
 * showing a green badge while the document still carries noindex would be
 * telling the visitor something the page itself contradicts.
 */

export interface VerifyLabels {
  cta: string;
  checking: string;
  done: string;
  failed: string;
  notConfigured: string;
}

export function DomainVerifyButton({ token, labels }: { token: string; labels: VerifyLabels }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'checking' | 'pending' | 'error'>('idle');

  async function check() {
    setState('checking');
    try {
      const res = await fetch('/api/scan/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token })
      });

      const body = (await res.json().catch(() => ({}))) as {
        verified?: boolean;
        error?: string;
      };

      if (body.verified) {
        // Server-side refresh: the noindex lives in generateMetadata.
        router.refresh();
        return;
      }

      setState(body.error === 'not_configured' ? 'error' : 'pending');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="grid gap-2">
      <Button onClick={check} disabled={state === 'checking'} className="justify-self-start">
        <ShieldCheck className="me-2 h-4 w-4" aria-hidden />
        {state === 'checking' ? labels.checking : labels.cta}
      </Button>

      {state === 'pending' && (
        <p role="status" className="text-sm text-muted-foreground">
          {labels.failed}
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="text-sm text-muted-foreground">
          {labels.notConfigured}
        </p>
      )}
    </div>
  );
}
