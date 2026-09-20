import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The page a DPO sends to a colleague — so also the page that has to
 * survive being opened by the company it names.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const PAGE = 'src/app/[locale]/scan/[token]/page.tsx';
const LOCALES = ['en', 'fr', 'es', 'de', 'pt-br', 'ja', 'ar'] as const;

const messages = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}.json`)).scan as Record<string, unknown>])
);

describe('indexing follows proof of control', () => {
  const source = code(PAGE);

  it('is noindex until a domain is verified', () => {
    // Anyone can run a scan and share the link; a link is not a search
    // result. Google is invited in only once somebody has proved they
    // control the domain.
    expect(source).toContain('const verified = Boolean(scan.domain_verified_at)');
    expect(source).toContain('robots: { index: verified, follow: verified }');
  });

  it('is noindex for a token that matches nothing', () => {
    expect(source).toContain('if (!scan) return { robots: { index: false, follow: false } }');
  });

  it('validates the token shape before querying', () => {
    expect(source).toMatch(/\[A-Za-z0-9_-\]\{16,64\}/);
  });
});

describe('no verdict, anywhere', () => {
  const source = code(PAGE);

  it('publishes no score and no total', () => {
    // A number out of ten is a judgement wearing a fact's clothes, and a
    // reader would quote the number and drop the sentences that made it.
    expect(source).not.toMatch(/riskScore|risk_score|\/\s*100|score/i);
  });

  it('renders a not_found finding neutrally, not as a failure', () => {
    // "We looked and did not find it" is not a failure of the document: it
    // may be behind a script, on a sub-page, or written in words we did not
    // recognise. A red cross would say otherwise.
    expect(source).toContain('Minus');
    expect(source).not.toMatch(/text-destructive|XCircle|text-red/);
  });

  it('states the boundary at full size, not in small print', () => {
    expect(source).toContain("t('boundaryBody', { domain: scan.domain })");
    const boundary = source.slice(source.indexOf('boundaryHeading'));
    expect(boundary.slice(0, 400)).not.toContain('text-[10px]');
  });
});

describe('everything is checkable', () => {
  const source = code(PAGE);

  it('shows the source URL, the provenance, the date and the hash', () => {
    for (const piece of ['snapshot.url', 'snapshot.provenance', 'fetched_at', 'content_hash']) {
      expect(source, piece).toContain(piece);
    }
  });

  it('tells the reader how to reproduce the fetch', () => {
    // The sentence that makes every finding below refutable by somebody
    // who does not trust us.
    expect(source).toContain("t('hashHint')");
    expect(messages['en']!['hashHint']).toMatch(/hash it/i);
  });

  it('does not leak our referrer to the third party', () => {
    expect(source).toContain('noopener noreferrer nofollow');
  });
});

describe('seven locales, and the boundary in every one', () => {
  it('has the scan namespace everywhere with identical keys', () => {
    const shape = (o: Record<string, unknown>): string =>
      JSON.stringify(
        Object.keys(o)
          .sort()
          .map((k) =>
            typeof o[k] === 'object' && o[k] !== null
              ? [k, Object.keys(o[k] as object).sort()]
              : k
          )
      );

    const reference = shape(messages['en']!);
    for (const locale of LOCALES) {
      expect(shape(messages[locale]!), locale).toBe(reference);
    }
  });

  it('never says "absent" in any language', () => {
    // The word asserts the thing is not in the document. What we know is
    // that we looked and did not find it.
    for (const locale of LOCALES) {
      const notFound = String(messages[locale]!['findingNotFound']);
      expect(notFound.length, locale).toBeGreaterThan(5);
      expect(notFound.toLowerCase(), locale).not.toMatch(/^absent$|^absent\b/);
    }
  });

  it('carries the domain placeholder into the boundary sentence', () => {
    // The boundary names the company it is about. A generic one reads as
    // boilerplate and gets skipped.
    for (const locale of LOCALES) {
      expect(String(messages[locale]!['boundaryBody']), locale).toContain('{domain}');
    }
  });
});
