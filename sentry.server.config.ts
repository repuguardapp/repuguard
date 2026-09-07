import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

// TEMPORARILY DISABLED — root-cause isolation for the production login
// outage (Sept 2026). Every POST to an App Router Route Handler
// (/api/auth/magic-link, /api/auth/signout) was failing on Vercel's
// production runtime with a platform-level 400 "Raw body unavailable"
// before our own handler code ran, at 6-7ms with zero outgoing
// requests. Disabling the Next.js-level route-file auto-instrumentation
// (autoInstrumentAppDirectory / autoInstrumentServerFunctions in
// next.config.mjs) did NOT resolve it.
//
// tracesSampleRate > 0 below enables Sentry's performance tracing,
// which auto-registers OpenTelemetry-based HTTP instrumentation at
// the Node.js http/https module level — a layer BELOW the Next.js
// route-file wrapping, and one the previous fix never touched. That
// class of instrumentation is a known source of request-body-stream
// conflicts on serverless/edge-like runtimes.
//
// Hard-disabling Sentry.init() here entirely (not just tracing) is
// the cleanest experiment: it isolates whether ANY layer of Sentry's
// server-side instrumentation is the cause. If POST routes recover,
// re-enable with tracesSampleRate: 0 (error tracking only, no HTTP
// tracing) rather than reverting this whole block.
//
// TODO(post-incident): once confirmed, either restore with
// tracesSampleRate: 0, or pin @sentry/nextjs to a version verified
// not to auto-instrument the Node http module for tracing.
const SENTRY_SERVER_DISABLED = true;

if (dsn && !SENTRY_SERVER_DISABLED) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,

    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
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
