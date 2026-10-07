import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/i18n/locales.server', () => ({
  discoverLocales: async () => ['en', 'fr', 'es', 'de', 'pt-br', 'ja', 'ar']
}));
vi.mock('server-only', () => ({}));

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://compliance.example.com';
});

const { buildHreflangAlternates } = await import('../src/lib/hreflang');

describe('buildHreflangAlternates', () => {
  it('emits one entry per locale plus x-default', async () => {
    const alts = await buildHreflangAlternates('/pricing');
    expect(Object.keys(alts).sort()).toEqual(
      ['ar', 'de', 'en', 'es', 'fr', 'ja', 'pt-br', 'x-default'].sort()
    );
    expect(alts['ar']).toBe('https://compliance.example.com/ar/pricing');
    expect(alts['fr']).toBe('https://compliance.example.com/fr/pricing');
    // NOT /en/pricing. x-default names the URL that negotiates, and the
    // unprefixed path is the one that does — it answers 307 to a locale
    // chosen from Accept-Language and IP country.
    expect(alts['x-default']).toBe('https://compliance.example.com/pricing');
  });

  it('handles root path correctly', async () => {
    const alts = await buildHreflangAlternates('/');
    expect(alts['ja']).toBe('https://compliance.example.com/ja');
    expect(alts['x-default']).toBe('https://compliance.example.com/');
  });

  it('never names a locale as the default', async () => {
    // Search Console reported https://lexyflow.com/en as "duplicate,
    // Google chose a different canonical than the user" while x-default
    // pointed at /en. We were making two statements that did not agree:
    // the unprefixed URL is the language selector, and x-default said a
    // particular language was the fallback. Google kept the negotiating
    // URL and called ours a duplicate.
    for (const path of ['/', '/pricing', '/observatory', '/decisions']) {
      const alts = await buildHreflangAlternates(path);
      for (const locale of ['en', 'fr', 'es', 'de', 'pt-br', 'ja', 'ar']) {
        expect(alts['x-default']).not.toBe(alts[locale]);
      }
    }
  });
});
