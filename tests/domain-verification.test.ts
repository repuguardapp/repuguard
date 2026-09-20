import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The only act in this whole feature that reaches outside the page: it puts
 * a named company into search results under our analysis.
 *
 * Anyone may scan any domain and share the link, because a link is not a
 * search result. Only whoever administers the domain may allow the second
 * thing, and a DNS TXT record is how they say so.
 */

vi.mock('server-only', () => ({}));

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

let lib: typeof import('@/lib/domain-verification');
beforeAll(async () => {
  lib = await import('@/lib/domain-verification');
});

beforeEach(() => {
  process.env['DOMAIN_VERIFICATION_SECRET'] = 'test-secret';
});

describe('the token', () => {
  it('is stable, so a record added last month still verifies', () => {
    expect(lib.verificationToken('example.test')).toBe(lib.verificationToken('example.test'));
  });

  it('is different for every domain, and not computable from another', () => {
    // A hash of the domain alone would have let anyone derive any token.
    expect(lib.verificationToken('example.test')).not.toBe(lib.verificationToken('example.org'));
  });

  it('ignores the case a visitor typed', () => {
    expect(lib.verificationToken('Example.TEST')).toBe(lib.verificationToken('example.test'));
  });

  it('fails closed when the secret is missing', () => {
    // The signup bot gate returned success for months with its secret
    // absent. A verification that silently accepted anything would be
    // worse: it would grant indexing of other people's names.
    delete process.env['DOMAIN_VERIFICATION_SECRET'];
    expect(lib.verificationToken('example.test')).toBeNull();
  });
});

describe('where the record goes', () => {
  it('is a subdomain, never the apex', () => {
    // The apex TXT record holds SPF and DMARC. Asking somebody to edit it
    // for our indexing would be asking them to risk their email.
    expect(lib.verificationRecordName('example.test')).toBe('_lexyflow.example.test');
  });

  it('is explained to the visitor in every language', () => {
    for (const locale of ['en', 'fr', 'es', 'de', 'pt-br', 'ja', 'ar']) {
      const scan = JSON.parse(read(`messages/${locale}.json`)).scan as Record<string, string>;
      expect(scan['verifyWhySubdomain'], locale).toBeTruthy();
      expect(scan['verifyLead'], locale).toContain('{domain}');
    }
  });
});

describe('the comparison', () => {
  it('is constant time, because a token is a credential', () => {
    // === would leak how much of the expected value a guess got right,
    // one character at a time.
    const source = code('src/lib/domain-verification.ts');
    expect(source).toContain('timingSafeEqual');
    expect(source).toContain('left.length === right.length');
  });

  it('joins a split TXT record before comparing', () => {
    // A value over 255 characters arrives in chunks; the record is their
    // concatenation, which is what every resolver expects.
    expect(code('src/lib/domain-verification.ts')).toContain("chunks.join('')");
  });
});

describe('what the endpoint does and does not grant', () => {
  const route = code('src/app/api/scan/verify/route.ts');

  it('treats the scan token as an address, not as authorisation', () => {
    // Somebody who guessed a token still cannot publish a record in a zone
    // they do not administer.
    expect(route).toContain('checkDomainTxt(domain)');
    expect(read('src/app/api/scan/verify/route.ts')).toContain('It does NOT authorise anything');
  });

  it('answers 200 when the record is simply not there yet', () => {
    // DNS propagation is minutes to hours. A visitor who added the record
    // thirty seconds ago has done everything right, and an error status
    // would tell them otherwise.
    expect(route).toContain('verified: false');
    expect(route).not.toMatch(/status:\s*4\d\d\s*\}\s*\)\s*;\s*\n\s*\}\s*\n\s*const result/);
  });

  it('never removes a verification', () => {
    // A domain that stops publishing the record keeps it. Taking it away
    // would let a tidied DNS zone read as a change of mind nobody
    // expressed.
    expect(route).not.toMatch(/\.delete\(\)|is_verified:\s*false|verified_at:\s*null/);
  });

  it('fails closed when the secret is missing', () => {
    expect(route).toContain("error: 'not_configured'");
    expect(route).toContain('status: 503');
  });
});

describe('the page', () => {
  const page = code('src/app/[locale]/scan/[token]/page.tsx');

  it('asks the domain, not the scan row', () => {
    // 0035 put the flag on `scans`, which would have had to be copied onto
    // every future scan of the same domain or silently not apply to it.
    expect(page).toContain('isDomainVerified(scan.domain)');
    expect(page).not.toContain('domain_verified_at');
  });

  it('drives noindex from the same answer the badge uses', () => {
    // A green badge over a document still carrying noindex would tell the
    // visitor something the page itself contradicts.
    expect(page).toContain('robots: { index: verified, follow: verified }');
  });

  it('offers verification only when there is something to index', () => {
    expect(page).toContain("!verified && scan.status === 'done' && txtValue");
  });
});
