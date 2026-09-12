import { describe, expect, it } from 'vitest';
import robots from '../src/app/robots';

/**
 * robots.txt matches a literal prefix from the root of the site.
 *
 * The middleware forces a locale prefix onto every non-API request, so
 * the dashboard's real URL is /en/dashboard, not /dashboard. This file
 * therefore spent its life disallowing paths that only ever redirect
 * and allowing the ones that actually serve content: every private
 * surface — the dashboard, onboarding, the new admin review queue —
 * was crawlable in practice while the policy looked correct.
 */

const LOCALES = ['en', 'fr', 'es', 'de', 'pt-br', 'ja', 'ar'];
const PRIVATE = ['/dashboard/', '/admin/', '/onboarding', '/embed/', '/monitoring/'];

function crawlerRule() {
  const rules = robots().rules;
  const list = Array.isArray(rules) ? rules : [rules];
  const rule = list.find((r) => r.userAgent === '*');
  if (!rule) throw new Error('no rule for general crawlers');
  const disallow = rule.disallow;
  return Array.isArray(disallow) ? disallow : disallow ? [disallow] : [];
}

/** Does any disallow pattern cover this path? `*` matches any run. */
function isDisallowed(path: string): boolean {
  return crawlerRule().some((pattern) => {
    const regex = new RegExp(
      '^' + pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
    );
    return regex.test(path);
  });
}

describe('private surfaces are disallowed at the URLs they actually have', () => {
  for (const path of PRIVATE) {
    it(`covers ${path} under every locale prefix`, () => {
      expect(isDisallowed(path), `${path} itself`).toBe(true);
      for (const locale of LOCALES) {
        expect(isDisallowed(`/${locale}${path}`), `/${locale}${path}`).toBe(true);
      }
    });
  }

  it('covers the admin review queue, where unpublished material is quoted', () => {
    expect(isDisallowed('/en/admin/legal-queue')).toBe(true);
    expect(isDisallowed('/ar/admin/legal-queue')).toBe(true);
  });

  it('covers /api/ , which is not locale-prefixed', () => {
    expect(isDisallowed('/api/audit')).toBe(true);
  });
});

describe('the marketing surface stays crawlable', () => {
  const PUBLIC = [
    '/en',
    '/fr/pricing',
    '/ar/compliance/saudi_pdpl',
    '/ja/compare/gdpr-vs-qatar_pdppl',
    '/en/trust',
    '/en/sample-report'
  ];

  for (const path of PUBLIC) {
    it(`leaves ${path} alone`, () => {
      // Over-blocking would be the expensive kind of caution: these
      // ~266 pages are the acquisition strategy.
      expect(isDisallowed(path)).toBe(false);
    });
  }
});

describe('AI training crawlers are blocked outright', () => {
  it('blocks the whole site for each named agent', () => {
    const rules = robots().rules;
    const list = Array.isArray(rules) ? rules : [rules];
    const named = list.filter((r) => r.userAgent !== '*');

    expect(named.length).toBeGreaterThan(10);
    for (const rule of named) {
      expect(rule.disallow).toBe('/');
    }
  });
});
