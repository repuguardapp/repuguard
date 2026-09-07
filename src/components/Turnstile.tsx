'use client';

import { useEffect, useRef } from 'react';

/**
 * Minimal Cloudflare Turnstile widget — no npm dependency, just the
 * official script + explicit render API. Chosen over reCAPTCHA
 * because it doesn't track visitors across sites, which matters for
 * a product whose entire pitch is "we don't leak your data" — using
 * Google's tracking-heavy captcha on the signup form would undercut
 * that positioning.
 *
 * Explicit render (not the auto-render `cf-turnstile` div class) is
 * used deliberately: auto-render scans the DOM on script load, which
 * races badly with React's own DOM reconciliation on a form that can
 * re-render (error states, locale changes). Explicit render gives us
 * a stable widget id we control the lifecycle of.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
let scriptLoadPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('turnstile_script_failed'));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

export interface TurnstileHandle {
  reset: () => void;
}

interface Props {
  siteKey: string;
  onToken: (token: string) => void;
  /** Fired when a token expires or the challenge errors — clear any cached token upstream. */
  onInvalidate?: () => void;
}

export function Turnstile({ siteKey, onToken, onInvalidate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => onToken(token),
          'expired-callback': () => onInvalidate?.(),
          'error-callback': () => onInvalidate?.()
        });
      })
      .catch((err) => console.error('[turnstile] load_failed', err));

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  return <div ref={containerRef} />;
}
