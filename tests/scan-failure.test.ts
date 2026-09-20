import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyScanFailure } from '@/lib/scan-failure';

/**
 * `read ECONNRESET` is exact and means nothing to a data protection
 * officer — and it was printed in English on a French page, on the one
 * line a visitor most needs to understand.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const LOCALES = ['en', 'fr', 'es', 'de', 'pt-br', 'ja', 'ar'] as const;
const messages = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}.json`)).scan as Record<string, string>])
);

const KEYS = [
  'failureRefusedConnection',
  'failureUnreachable',
  'failureTls',
  'failureRobots',
  'failureNoLink',
  'failureShellPage',
  'failurePdf',
  'failureHttpError',
  'failureOther'
];

describe('reading the machine correctly', () => {
  it('calls a reset what it is', () => {
    // The real one, from uber.fr.
    expect(classifyScanFailure('we could not read the homepage: read ECONNRESET')).toBe(
      'refused_connection'
    );
    expect(classifyScanFailure('socket hang up')).toBe('refused_connection');
  });

  it('separates a reset from a host that never answered', () => {
    // A site that refused us and a domain that does not exist are
    // different answers, and only the first is about a decision.
    expect(classifyScanFailure('getaddrinfo ENOTFOUND uber.fr')).toBe('unreachable');
    expect(classifyScanFailure('The operation was aborted due to timeout')).toBe('unreachable');
  });

  it('recognises our own refusals', () => {
    expect(classifyScanFailure('robots.txt disallows us')).toBe('robots');
    expect(classifyScanFailure('the policy is a PDF, which this scan does not read yet')).toBe('pdf');
    expect(
      classifyScanFailure('only 210 characters of text — the page is probably built in the browser')
    ).toBe('shell_page');
    expect(classifyScanFailure('the homepage was read and links to no privacy policy')).toBe(
      'no_link'
    );
  });

  it('falls back rather than guessing', () => {
    expect(classifyScanFailure('something nobody anticipated')).toBe('other');
    expect(classifyScanFailure(null)).toBe('other');
  });
});

describe('what the sentences may and may not say', () => {
  it('exists in all seven languages', () => {
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        expect(messages[locale]![key], `${locale}.${key}`).toBeTruthy();
      }
      expect(messages[locale]!['failureTechnical']).toBeTruthy();
    }
  });

  it('never says the company has no policy or is at fault', () => {
    // Every sentence is a fact about our connection attempt. None is a
    // claim about the organisation.
    for (const locale of ['en', 'fr'] as const) {
      const all = KEYS.map((k) => messages[locale]![k]).join(' ').toLowerCase();
      for (const forbidden of [
        'non conforme',
        'non-compliant',
        'violation',
        'has no privacy policy',
        "n'a pas de politique"
      ]) {
        expect(all, `${locale}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('says out loud that we do not work around a refusal', () => {
    // The decision worth being unable to quietly reverse: we could very
    // probably get past bot mitigation with browser-shaped headers, and a
    // compliance company that disguises its crawler has nothing left to
    // sell.
    expect(messages['fr']!['failureRefusedConnection']).toMatch(/ne cherchons pas à le contourner/i);
    expect(messages['en']!['failureRefusedConnection']).toMatch(/do not try to get around it/i);
    expect(read('src/lib/scan-failure.ts')).toContain('WE DO NOT WORK AROUND A REFUSAL');
  });
});

describe('the retry, and its limit', () => {
  const discovery = read('src/lib/policy-discovery.ts')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('retries a reset exactly once', () => {
    // Asking twice is ordinary. Asking for ever is a denial of service
    // against somebody who already said no.
    expect(discovery).toContain('retry = true');
    expect(discovery).toContain('return get(url, accept, false)');
  });

  it('never changes what we look like between attempts', () => {
    // No browser user agent, no Sec-Fetch headers, nothing that hides what
    // we are. The retry is the same request, once more.
    expect(discovery).not.toMatch(/Mozilla|Chrome\/|Sec-Fetch/i);
    // The name lives in robots.ts, which is where USER_AGENT is defined;
    // discovery only interpolates it. Asserted in both places rather than
    // grepping the wrong file, which is what the first version did.
    expect(discovery).toContain('${USER_AGENT}/1.0');
    expect(read('src/lib/robots.ts')).toContain("USER_AGENT = 'LexyFlowScan'");
  });
});
