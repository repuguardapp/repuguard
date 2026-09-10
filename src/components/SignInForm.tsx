'use client';

import { CheckCircle2, Mail, RefreshCw, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Turnstile } from '@/components/Turnstile';

export interface SignInFormLabels {
  emailLabel: string;
  emailPlaceholder: string;
  submit: string;
  submitting: string;
  inboxTitle: string;
  inboxBody: string;
  inboxRetry: string;
  errorService: string;
  errorRateLimited: string;
  errorGeneric: string;
}

interface Props {
  locale: string;
  labels: SignInFormLabels;
}

type View =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'sent'; email: string }
  | { phase: 'error'; message: string };

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * Magic-link sign-in form.
 *
 * Three terminal states surfaced to the user:
 *   - sent     → success card with a "didn't receive it?" retry button
 *                that re-sends without forcing the user to retype.
 *   - error    → red banner with a localized cause:
 *                  503 → labels.errorService    (env missing, Supabase down)
 *                  429 → labels.errorRateLimited
 *                  any other 4xx/5xx → labels.errorGeneric (also covers
 *                    a failed captcha — see the server route)
 *   - idle     → editable form
 *
 * The previous implementation showed "Check your inbox" regardless of
 * what happened on the backend. The CEO flagged this as the "user
 * waits in the void" failure mode — now any hard failure surfaces a
 * specific message and a path forward.
 *
 * Turnstile widget: rendered only when NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * is configured — no-ops cleanly before that env var is set up, same
 * pattern as the PostHog/Tolt integrations. Submit is disabled until
 * a token is captured, since Turnstile tokens are short-lived and
 * single-use — a stale token would just fail server-side verification
 * anyway, so gating client-side saves the user a round trip.
 *
 * The "sent" card's widget is unmounted (it's a different screen), so
 * its one-click resend can't carry a fresh token once captcha is
 * required — sending without one just fails server-side. When captcha
 * is on, resend instead drops back to the form (email prefilled) so
 * the user solves a fresh challenge; the instant one-click resend is
 * only safe while captcha is off.
 */
export function SignInForm({ locale, labels }: Props) {
  const [view, setView] = useState<View>({ phase: 'idle' });
  const [lastEmail, setLastEmail] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Bumping this key forces Turnstile's widget to fully remount,
  // which is the reliable way to get a fresh token after a token has
  // been consumed (a submit attempt) or has expired.
  const [turnstileKey, setTurnstileKey] = useState(0);

  async function send(email: string) {
    setView({ phase: 'submitting' });
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          locale,
          ...(turnstileToken ? { turnstileToken } : {})
        })
      });

      // Tokens are single-use regardless of outcome — force a fresh
      // challenge for the next attempt.
      setTurnstileToken(null);
      setTurnstileKey((k) => k + 1);

      if (res.status === 429) {
        setView({ phase: 'error', message: labels.errorRateLimited });
        return;
      }
      if (res.status === 503) {
        setView({ phase: 'error', message: labels.errorService });
        return;
      }
      if (!res.ok) {
        setView({ phase: 'error', message: labels.errorGeneric });
        return;
      }

      setLastEmail(email);
      setView({ phase: 'sent', email });
    } catch (err) {
      console.error('[signin] fetch_failed', err);
      setView({ phase: 'error', message: labels.errorGeneric });
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    if (!email) return;
    await send(email);
  }

  const needsCaptcha = Boolean(TURNSTILE_SITE_KEY);

  if (view.phase === 'sent') {
    return (
      <div className="grid gap-3 rounded-md border bg-muted/40 p-6 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-green-600" />
        <div className="font-medium">{labels.inboxTitle}</div>
        <p className="text-sm text-muted-foreground">{labels.inboxBody}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mx-auto mt-2"
          onClick={() => (needsCaptcha ? setView({ phase: 'idle' }) : send(lastEmail))}
        >
          <RefreshCw className="me-2 h-4 w-4" aria-hidden />
          {labels.inboxRetry}
        </Button>
      </div>
    );
  }

  const submitting = view.phase === 'submitting';
  const captchaBlocking = needsCaptcha && !turnstileToken;

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <label className="grid gap-1.5">
        <span className="text-sm font-medium">{labels.emailLabel}</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          defaultValue={lastEmail}
          placeholder={labels.emailPlaceholder}
          className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>

      {needsCaptcha && (
        <Turnstile
          key={turnstileKey}
          siteKey={TURNSTILE_SITE_KEY!}
          onToken={setTurnstileToken}
          onInvalidate={() => setTurnstileToken(null)}
        />
      )}

      {view.phase === 'error' && (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
          <span>{view.message}</span>
        </div>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={submitting || captchaBlocking}>
        <Mail className="me-2 h-4 w-4" />
        {submitting ? labels.submitting : labels.submit}
      </Button>
    </form>
  );
}
