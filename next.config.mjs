import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: '25mb' },
    // Lets us use src/instrumentation.ts to boot Sentry per-runtime.
    instrumentationHook: true,
    // Keep these out of the webpack bundle — they ship Node-only code that
    // the serverless cold-start cannot evaluate (e.g. pdfjs-dist references
    // DOMMatrix at module load). Loaded via require() at runtime instead.
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist', 'mammoth']
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }
        ]
      }
    ];
  }
};

const withIntl = withNextIntl(nextConfig);

// Sentry's wrapper is a no-op without SENTRY_AUTH_TOKEN — safe to enable
// in every environment. It uploads sourcemaps when the token is present.
export default withSentryConfig(withIntl, {
  silent: !process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Tunneling routes Sentry traffic through our origin to dodge ad blockers.
  tunnelRoute: '/monitoring',
  hideSourceMaps: true,
  disableLogger: true,
  // Disabled: Sentry's automatic Route Handler / Server Action wrapping
  // (App Router) reads the incoming request to attach breadcrumbs before
  // our own handler gets to call request.json(). On Vercel's production
  // Fluid Compute runtime this raced with our body reads and produced a
  // platform-level "Raw body unavailable" 400 on EVERY POST to an App
  // Router route handler — including /api/auth/signout, which contains
  // no body-parsing code at all, proving the failure originated in this
  // wrapper rather than in our application logic. Not reproducible under
  // local `next start`, which doesn't replicate Fluid Compute's request
  // object plumbing — production-only regression, first appeared after
  // the app started actually being used post-launch (nobody POSTed to
  // one of these routes enough to notice earlier).
  //
  // We already log every meaningful server-side failure by hand
  // (console.error at every catch site — see /api/auth/magic-link,
  // /api/stripe-webhook, /api/audit, etc.), so turning this off costs
  // us Sentry's automatic uncaught-exception capture for Route Handlers
  // specifically; client-side error tracking (sentry.client.config.ts)
  // and manually-instrumented server errors are unaffected.
  autoInstrumentServerFunctions: false,
  autoInstrumentAppDirectory: false
});
