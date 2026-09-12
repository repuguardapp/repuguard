import * as Sentry from '@sentry/nextjs';
import { redactQueryString, redactUrl } from './src/lib/sentry-scrub';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 1.0,
    sendDefaultPii: false,

    // This runtime had no beforeSend at all, which made it the least
    // filtered of the three and the one that sees the most URLs: the
    // edge runtime is where our middleware runs, so every request to
    // the site passes through it — including /api/admin/* and
    // /api/cron/*, which take their credential as ?secret=.
    beforeSend: scrubPII,
    beforeBreadcrumb: scrubBreadcrumb
  });
}

function scrubPII(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
      delete event.request.headers['x-api-key'];
    }
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
  if (crumb.data) {
    delete crumb.data['body'];
    delete crumb.data['Authorization'];
    if (typeof crumb.data['url'] === 'string') {
      crumb.data['url'] = redactUrl(crumb.data['url']);
    }
  }
  return crumb;
}
