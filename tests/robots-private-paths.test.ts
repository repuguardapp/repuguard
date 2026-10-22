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
/**
 * `/embed/` is NOT in this list any more, and that is the change of
 * 22 October rather than an omission. /[locale]/embed is the page that
 * documents the widget and it is meant to be indexed — it is the only
 * acquisition channel that earns inbound links without prospecting.
 * The widget target itself stays out, and the pair of assertions below
 * holds both halves.
 */
const PRIVATE = ['/dashboard/', '/admin/', '/onboarding', '/embed/audit', '/monitoring/', '/auth/confirm'];

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

describe('the widget target is closed and the page describing it is open', () => {
  it('keeps /embed/audit out of the index', () => {
    // A bare iframe target is not a page anybody should land on from a
    // search result.
    expect(isDisallowed('/embed/audit')).toBe(true);
    for (const locale of LOCALES) {
      expect(isDisallowed(`/${locale}/embed/audit`), `/${locale}/embed/audit`).toBe(true);
    }
  });

  it('lets /embed itself be crawled', () => {
    /**
     * The whole point of the page. Disallowing `/embed/` as a prefix
     * would have blocked it on the trailing slash alone — a difference
     * no one would have noticed until the page failed to appear and
     * somebody spent a day on the sitemap.
     */
    for (const locale of LOCALES) {
      expect(isDisallowed(`/${locale}/embed`), `/${locale}/embed`).toBe(false);
    }
  });
});

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
