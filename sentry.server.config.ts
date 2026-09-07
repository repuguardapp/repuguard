import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

// RESOLVED (Sept 2026 login outage, root-caused in
// sentry.client.config.ts) — the actual bug was CLIENT-side:
// tracesSampleRate > 0 with no explicit `integrations` array made the
// browser SDK auto-register browserTracingIntegration(), which
// monkey-patches window.fetch and corrupted the POST body Safari sent
// for /api/auth/magic-link and /api/auth/signout before it ever left
// the browser. This server config was hard-disabled for a few hours
// while we chased that down (a red herring — server-side
// instrumentation was never the cause), then restored here.
//
// tracesSampleRate stays at 0 as a precaution: same class of fetch/
// http instrumentation risk exists in the Node SDK too (see the old
// comment this replaced), and we don't have a pressing need for
// server-side performance tracing. Error capture — the actual point
// of Sentry — is unaffected by tracesSampleRate.
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,

    tracesSampleRate: 0,
    sendDefaultPii: false,

    beforeSend: scrubPII,
    beforeBreadcrumb: scrubBreadcrumb
  });
}

function scrubPII(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  // Documents in /api/audit are uploaded as multipart bodies. Never let
  // their bytes flow to Sentry.
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
      delete event.request.headers['stripe-signature'];
      delete event.request.headers['x-api-key'];
    }
  }
  // Strip query strings that might carry tokens.
  if (event.request?.query_string && typeof event.request.query_string === 'string') {
    event.request.query_string = event.request.query_string.replace(
      /(token_hash|code|access_token|refresh_token)=[^&]+/gi,
      '$1=REDACTED'
    );
  }
  return event;
}

function scrubBreadcrumb(crumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (crumb.category === 'http' || crumb.category === 'fetch') {
    if (crumb.data) {
      delete crumb.data['body'];
      delete crumb.data['Authorization'];
    }
  }
  return crumb;
}
