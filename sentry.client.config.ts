import * as Sentry from '@sentry/nextjs';
import { redactQueryString, redactUrl } from './src/lib/sentry-scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// ROOT CAUSE (Sept 2026 login outage) — every POST fetch() from the
// browser to an App Router Route Handler (/api/auth/magic-link,
// /api/auth/signout) arrived at the server with a broken body,
// rejected at the platform level before our handler code ran ("Raw
// body unavailable", 400, on EVERY attempt, reproduced only through a
// real browser — never through a local curl POST with the identical
// server code, which always worked).
//
// tracesSampleRate > 0 with no explicit `integrations` array makes
// @sentry/nextjs auto-register `browserTracingIntegration()`, which
// monkey-patches `window.fetch` to wrap outgoing requests in spans.
// Safari's fetch()/Request body-handling has long-standing, well-
// documented interoperability issues with libraries that clone or
// intercept the body before the real network send — the affected
// user's requests were all from Safari on iPadOS. Disabling the
// server-side Sentry instrumentation first (commit 453b6ec) did NOT
// fix this, which in hindsight is the exact evidence pointing here
// instead: the corruption happens client-side, before the request
// ever leaves the browser, so nothing on the server side could ever
// have fixed it.
//
// Fix: tracesSampleRate: 0 stops the SDK from auto-registering
// browser tracing / fetch instrumentation. Error capture (the actual
// point of having Sentry) is unaffected — only performance tracing
// (and its fetch-wrapping side effect) is disabled.
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,

    // See note above — this used to be 0.1 in production. Do not
    // re-enable without confirming the fetch-instrumentation Safari
    // issue is resolved upstream in @sentry/nextjs, or without
    // explicitly excluding BrowserTracing from `integrations`.
    tracesSampleRate: 0,

    // Session replay disabled by default — would otherwise capture form
    // input on /audit which is the very thing we promise not to retain.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Belt-and-braces: scrub anything that smells like PII even if a
    // breadcrumb slips through.
    beforeSend: scrubPII,
    beforeBreadcrumb: scrubBreadcrumb
  });
}

function scrubPII(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  // Strip request bodies entirely — the audit body is the source document.
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
      delete event.request.headers['x-api-key'];
    }
    // The browser reports the page URL, and an operator who opened an
    // admin endpoint in a tab has the credential in it.
    if (typeof event.request.query_string === 'string') {
      event.request.query_string = redactQueryString(event.request.query_string);
    }
    if (event.request.url) {
      event.request.url = redactUrl(event.request.url);
    }
  }
  return event;
}

function scrubBreadcrumb(crumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (crumb.category === 'fetch' || crumb.category === 'xhr') {
    if (crumb.data) {
      delete crumb.data['body'];
      delete crumb.data['Authorization'];
    }
  }
  // Navigation breadcrumbs carry from/to URLs whatever the category.
  if (crumb.data) {
    for (const key of ['url', 'from', 'to']) {
      const value = crumb.data[key];
      if (typeof value === 'string') crumb.data[key] = redactUrl(value);
    }
  }
  return crumb;
}
