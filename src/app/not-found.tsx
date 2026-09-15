import type { Metadata } from 'next';

/**
 * The 404 page — and until now there wasn't one.
 *
 * notFound() looks for [locale]/not-found.tsx, then app/not-found.tsx,
 * then falls back to Next's built-in, which renders a bare <div> and
 * relies on a layout to supply the document around it. Our root layout
 * returns `children` untouched, deliberately, because the locale layout
 * owns <html lang> and <html dir> so one shell can serve LTR and RTL
 * without remounting.
 *
 * The two are individually reasonable and fatal together: a 404
 * rendered a document with no <html> and no <body>, which every browser
 * shows as a blank white page. Every wrong URL on the site — a stale
 * link from a search engine, a deleted audit, a mistyped path, an admin
 * page refusing a visitor who is not on the allowlist — has been a
 * blank page since launch. It took three separate investigations to
 * notice, because a blank page looks like an outage, a broken session
 * and a misconfigured variable all at once.
 *
 * So this file renders its own document, exactly like global-error.tsx
 * and for the same reason: it is reached when the layout that would
 * normally provide one is not in play.
 *
 * English-only and dependency-free on purpose. A 404 can be reached at
 * a path with no locale segment at all, so there is no reliable locale
 * to translate into and nothing to load that could itself fail.
 */

export const metadata: Metadata = {
  title: 'Page not found — LexyFlow',
  robots: { index: false, follow: false }
};

export default function NotFound() {
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
          <p
            style={{
              fontSize: '0.75rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#a3a3a3',
              margin: '0 0 0.75rem'
            }}
          >
            LexyFlow
          </p>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.75rem' }}>
            Page not found
          </h1>
          <p style={{ margin: '0 0 1.5rem', color: '#525252', lineHeight: 1.6 }}>
            This address does not exist, or you do not have access to it. Your audits and reports
            are unaffected.
          </p>
          <a
            href="/"
            style={{
              display: 'inline-block',
              borderRadius: '0.375rem',
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              background: '#0a0a0a',
              color: '#ffffff',
              textDecoration: 'none'
            }}
          >
            Back to LexyFlow
          </a>
        </main>
      </body>
    </html>
  );
}
