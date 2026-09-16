import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { absoluteUrl, appUrl } from '@/lib/app-url';

/**
 * One origin, one fallback.
 *
 * NEXT_PUBLIC_APP_URL was read in seventeen modules with nine different
 * fallbacks. Two of them would not have failed loudly if the variable
 * ever went missing in production — they would have succeeded, wrongly,
 * to Google:
 *
 *   sitemap.ts  → 'https://example.com'   (360 URLs on someone else's domain)
 *   layout.tsx  → 'http://localhost:3000' (metadataBase: every canonical,
 *                                          every hreflang, every OG URL)
 *
 * Nothing about that is visible from inside the app. It is visible in
 * Search Console, weeks later, as a site that does not exist.
 */

const original = process.env['NEXT_PUBLIC_APP_URL'];

afterEach(() => {
  if (original === undefined) delete process.env['NEXT_PUBLIC_APP_URL'];
  else process.env['NEXT_PUBLIC_APP_URL'] = original;
});

describe('a missing variable cannot produce a wrong URL', () => {
  it('falls back to the real domain, not to a placeholder', () => {
    delete process.env['NEXT_PUBLIC_APP_URL'];
    expect(appUrl()).toBe('https://lexyflow.com');
  });

  it('treats blank and whitespace as missing', () => {
    // Vercel will happily store an empty string, and '' is falsy in a
    // `??` chain only by accident — `?? ` does not catch it at all.
    for (const value of ['', '   ']) {
      process.env['NEXT_PUBLIC_APP_URL'] = value;
      expect(appUrl(), JSON.stringify(value)).toBe('https://lexyflow.com');
    }
  });

  it('strips a trailing slash', () => {
    // 'https://lexyflow.com/' + '/fr/pricing' is a different URL to a
    // crawler than the real one, and a duplicate of it.
    process.env['NEXT_PUBLIC_APP_URL'] = 'https://lexyflow.com/';
    expect(appUrl()).toBe('https://lexyflow.com');
    expect(absoluteUrl('/fr/pricing')).toBe('https://lexyflow.com/fr/pricing');
  });

  it('builds an absolute URL whether or not the path has a slash', () => {
    process.env['NEXT_PUBLIC_APP_URL'] = 'https://lexyflow.com';
    expect(absoluteUrl('/en/audit')).toBe('https://lexyflow.com/en/audit');
    expect(absoluteUrl('en/audit')).toBe('https://lexyflow.com/en/audit');
  });
});

describe('nothing reintroduces a second source of truth', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }

  const files = walk(join(__dirname, '..', 'src')).filter(
    (f) => !f.endsWith(join('lib', 'app-url.ts'))
  );

  it('reads the environment variable in exactly one module', () => {
    const offenders = files.filter((f) =>
      readFileSync(f, 'utf8').includes('NEXT_PUBLIC_APP_URL')
    );
    expect(offenders.map((f) => f.split('/src/')[1])).toEqual([]);
  });

  it('has no placeholder origin anywhere in the source', () => {
    // The two that were there. A grep is the only thing that would have
    // caught them, so the grep is the test.
    const offenders = files.filter((f) => {
      const source = readFileSync(f, 'utf8');
      return source.includes('https://example.com') || source.includes('http://localhost:3000');
    });
    expect(offenders.map((f) => f.split('/src/')[1])).toEqual([]);
  });
});
