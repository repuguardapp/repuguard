import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { redactQueryString, redactUrl } from '../src/lib/sentry-scrub';

/**
 * The first event this Sentry project ever received arrived carrying
 * `secret=[Filtered]`. Filtered is Sentry's OWN server-side scrubber,
 * which means our admin credential travelled to Sentry in full and was
 * redacted on arrival. Relying on the recipient to discard a
 * credential is not the same as never sending it.
 *
 * The endpoint it leaked through was /api/admin/selftest-alerting —
 * the one built to prove our alerting works.
 */

describe('credential redaction', () => {
  it('redacts the admin and cron credential', () => {
    expect(redactQueryString('secret=sntrys_abc123')).toBe('secret=REDACTED');
  });

  it('redacts every auth parameter the app uses', () => {
    const qs = 'token_hash=a&code=b&access_token=c&refresh_token=d&api_key=e';
    const out = redactQueryString(qs);
    expect(out).toBe(
      'token_hash=REDACTED&code=REDACTED&access_token=REDACTED&refresh_token=REDACTED&api_key=REDACTED'
    );
  });

  it('leaves harmless parameters intact so events stay useful', () => {
    expect(redactQueryString('page=2&secret=xyz&locale=fr')).toBe(
      'page=2&secret=REDACTED&locale=fr'
    );
  });

  it('redacts inside a full URL, not just a bare query string', () => {
    expect(redactUrl('https://lexyflow.com/api/admin/selftest-alerting?secret=abc')).toBe(
      'https://lexyflow.com/api/admin/selftest-alerting?secret=REDACTED'
    );
  });

  it('is case-insensitive and survives a value with punctuation', () => {
    expect(redactQueryString('SECRET=aB3-_x.y~z')).toBe('SECRET=REDACTED');
  });

  it('does not redact a parameter that merely contains a keyword', () => {
    // `secretless` is not `secret`; over-redacting hides useful context.
    expect(redactQueryString('not_a_secret_field=keepme')).toContain('keepme');
  });
});

/**
 * The three runtime configs are separate files with no type
 * relationship, and they had already drifted: the server config
 * redacted four parameters, the client config redacted none from URLs,
 * and the edge config — the runtime our middleware uses, so the one
 * that sees every request to the site — had no beforeSend at all.
 */
describe('all three Sentry runtimes are filtered', () => {
  const root = join(__dirname, '..');

  for (const config of [
    'sentry.server.config.ts',
    'sentry.client.config.ts',
    'sentry.edge.config.ts'
  ]) {
    it(`${config} installs beforeSend and uses the shared redactor`, () => {
      const source = readFileSync(join(root, config), 'utf8');
      expect(source, `${config} has no beforeSend`).toContain('beforeSend');
      expect(source, `${config} does not use the shared redactor`).toContain('sentry-scrub');
    });
  }
});
