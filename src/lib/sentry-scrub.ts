/**
 * Credential redaction shared by all three Sentry runtimes.
 *
 * Deliberately dependency-free and free of `server-only`: this module
 * is imported by sentry.client.config.ts as well as the server and edge
 * configs, and the whole point is that the three cannot drift apart.
 * They had already drifted — the server config redacted four query
 * parameters, the edge config had no beforeSend at all, and neither
 * list included `secret`, which is how our admin and cron endpoints
 * take their credential.
 *
 * We found that out from the first event this project ever received:
 * it arrived carrying `secret=[Filtered]`. Filtered is Sentry's own
 * server-side scrubber, so the credential had travelled to Sentry in
 * full and was redacted on arrival. Relying on the recipient to discard
 * a credential is not the same as never sending it.
 */

/**
 * Query parameters that carry a credential in this codebase.
 *
 *   token_hash, code            Supabase auth callbacks
 *   access_token, refresh_token Supabase sessions
 *   secret                      /api/admin/* and /api/cron/*
 *   api_key                     public API callers
 */
const CREDENTIAL_QUERY_KEYS = [
  'token_hash',
  'code',
  'access_token',
  'refresh_token',
  'secret',
  'api_key'
] as const;

const CREDENTIAL_QUERY_RE = new RegExp(`(${CREDENTIAL_QUERY_KEYS.join('|')})=[^&]+`, 'gi');

/** Replace every credential value in a query string with REDACTED. */
export function redactQueryString(queryString: string): string {
  return queryString.replace(CREDENTIAL_QUERY_RE, '$1=REDACTED');
}

/** Replace every credential value found in a full or partial URL. */
export function redactUrl(url: string): string {
  return redactQueryString(url);
}
