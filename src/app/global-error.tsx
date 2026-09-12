'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Last-resort boundary: a React render error that escaped the locale
 * layout, or came from the root layout itself.
 *
 * Without this file, Next.js renders its own bare error page and
 * nothing is reported. next.config.mjs disables Sentry's automatic
 * Route Handler and App Directory instrumentation (it raced with our
 * body reads on Fluid Compute and produced "Raw body unavailable"
 * 400s), so client render errors had no path to Sentry at all.
 *
 * Deliberately English-only and dependency-free. This boundary renders
 * precisely when the layout above it failed — which is where the
 * locale, the message bundle and the i18n provider live. An error page
 * that needs the thing that just broke is not an error page.
 *
 * It must render <html> and <body>: it REPLACES the root layout.
 */
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
          background: '#ffffff',
          color: '#0a0a0a',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
        }}
      >
        <main style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.75rem' }}>
            Something went wrong
          </h1>
          <p style={{ margin: '0 0 1.5rem', color: '#525252', lineHeight: 1.6 }}>
            The error has been reported to our team automatically. Your audits and reports are
            unaffected — nothing is lost.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: 'pointer',
              border: 0,
              borderRadius: '0.375rem',
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              background: '#0a0a0a',
              color: '#ffffff'
            }}
          >
            Try again
          </button>
          {error.digest ? (
            // The digest is the only handle we and the customer share
            // when they write in. It is not sensitive: it identifies
            // the occurrence, it does not describe it.
            <p style={{ marginTop: '2rem', fontSize: '0.75rem', color: '#a3a3a3' }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
