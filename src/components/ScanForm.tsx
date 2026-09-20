'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * One field, and the honesty is in what happens when it goes wrong.
 *
 * Every failure this form can meet is a real answer to the visitor rather
 * than a generic apology. "This domain has been read several times
 * recently" tells them the reason and implies the remedy; "something went
 * wrong" tells them to try again for ever.
 *
 * The three refusals are also not equivalent, and the middle one is the
 * interesting one: `domain_rate_limited` is us protecting a site that is
 * not our visitor, and saying so out loud is the point rather than an
 * embarrassment.
 */

export interface ScanFormLabels {
  inputLabel: string;
  inputPlaceholder: string;
  submit: string;
  submitting: string;
  errorNotADomain: string;
  errorRateLimited: string;
  errorDomainRateLimited: string;
  errorService: string;
}

/**
 * The same class string AuditForm uses. There is no ui/input primitive in
 * this project and inventing one here would leave two conventions for a
 * text field, which is how a design drifts.
 */
const INPUT_CLASS =
  'block w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background';

export function ScanForm({ labels, locale }: { labels: ScanFormLabels; locale: string }) {
  const router = useRouter();
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || domain.trim().length < 4) return;

    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: domain.trim(), locale })
      });

      const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };

      if (res.ok && body.token) {
        // The result page reloads itself while the scan runs, so pushing
        // straight to it is correct even though nothing is ready yet.
        router.push(`/${locale}/scan/${body.token}`);
        return;
      }

      setError(messageFor(body.error, labels));
    } catch {
      // A network failure is not a bad domain, and telling the visitor
      // their domain was wrong when our own fetch failed would send them
      // to correct something that was correct.
      setError(labels.errorService);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <label htmlFor="scan-domain" className="text-sm font-medium">
        {labels.inputLabel}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="scan-domain"
          name="domain"
          value={domain}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDomain(event.target.value)}
          placeholder={labels.inputPlaceholder}
          // Not type="url": people type a bare domain, and a browser that
          // rejects "example.fr" for missing a scheme would turn the first
          // interaction into a correction. The server normalises it.
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={`${INPUT_CLASS} min-w-56 flex-1`}
          aria-describedby={error ? 'scan-error' : undefined}
          aria-invalid={error ? true : undefined}
        />
        <Button type="submit" disabled={busy || domain.trim().length < 4}>
          <Search className="me-2 h-4 w-4" aria-hidden />
          {busy ? labels.submitting : labels.submit}
        </Button>
      </div>

      {error && (
        <p
          id="scan-error"
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm leading-relaxed"
        >
          {error}
        </p>
      )}
    </form>
  );
}

function messageFor(code: string | undefined, labels: ScanFormLabels): string {
  switch (code) {
    case 'not_a_domain':
    case 'invalid_request':
      return labels.errorNotADomain;
    case 'rate_limited':
      return labels.errorRateLimited;
    case 'domain_rate_limited':
      return labels.errorDomainRateLimited;
    default:
      return labels.errorService;
  }
}
