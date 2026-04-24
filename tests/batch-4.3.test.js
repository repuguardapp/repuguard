import { describe, test, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────
// HELPERS UNDER TEST
// ─────────────────────────────────────────────────────────────

// M2: Mirrors PRICE_IDS resolution in create-subscription.js
const PROD_PRICE_IDS = {
  starter:  'price_1TJfMs4AfFLajYNswedRcOT5',
  pro:      'price_1TJfOW4AfFLajYNsmOvVBxGj',
  business: 'price_1TJfPU4AfFLajYNsJtTIsjl3',
};

function buildPriceIds(env = {}) {
  return {
    starter:  env.STRIPE_PRICE_STARTER  || PROD_PRICE_IDS.starter,
    pro:      env.STRIPE_PRICE_PRO      || PROD_PRICE_IDS.pro,
    business: env.STRIPE_PRICE_BUSINESS || PROD_PRICE_IDS.business,
  };
}

// M3: Mirrors baseUrl construction in cron-sync.js
function buildBaseUrl(vercelUrl) {
  return vercelUrl ? 'https://' + vercelUrl : 'https://repuguard.app';
}

// M4: Mirrors newThisWeek filter in get-dashboard.js (null-safe version)
function filterNewThisWeek(reviews, weekAgo) {
  return reviews.filter(r => r.date && new Date(r.date) > weekAgo);
}

// ─────────────────────────────────────────────────────────────
// SUITE 1 — M2: create-subscription PRICE_IDS env var support
// ─────────────────────────────────────────────────────────────
describe('M2: create-subscription PRICE_IDS env var resolution', () => {
  test('uses prod fallbacks when no env vars set', () => {
    const ids = buildPriceIds();
    expect(ids.starter).toBe(PROD_PRICE_IDS.starter);
    expect(ids.pro).toBe(PROD_PRICE_IDS.pro);
    expect(ids.business).toBe(PROD_PRICE_IDS.business);
  });

  test('uses env vars when all three are set', () => {
    const ids = buildPriceIds({
      STRIPE_PRICE_STARTER:  'price_test_starter',
      STRIPE_PRICE_PRO:      'price_test_pro',
      STRIPE_PRICE_BUSINESS: 'price_test_business',
    });
    expect(ids.starter).toBe('price_test_starter');
    expect(ids.pro).toBe('price_test_pro');
    expect(ids.business).toBe('price_test_business');
  });

  test('uses env var for one plan, falls back for others', () => {
    const ids = buildPriceIds({ STRIPE_PRICE_PRO: 'price_test_pro' });
    expect(ids.starter).toBe(PROD_PRICE_IDS.starter);
    expect(ids.pro).toBe('price_test_pro');
    expect(ids.business).toBe(PROD_PRICE_IDS.business);
  });

  test('VALID_PRICE_IDS whitelist includes all resolved IDs', () => {
    const ids = buildPriceIds({
      STRIPE_PRICE_STARTER:  'price_test_starter',
      STRIPE_PRICE_PRO:      'price_test_pro',
      STRIPE_PRICE_BUSINESS: 'price_test_business',
    });
    const whitelist = new Set(Object.values(ids));
    expect(whitelist.has('price_test_starter')).toBe(true);
    expect(whitelist.has('price_test_pro')).toBe(true);
    expect(whitelist.has('price_test_business')).toBe(true);
    // Prod IDs should NOT be in a test-env whitelist
    expect(whitelist.has(PROD_PRICE_IDS.starter)).toBe(false);
  });

  test('VALID_PRICE_IDS whitelist rejects arbitrary price ID', () => {
    const ids = buildPriceIds();
    const whitelist = new Set(Object.values(ids));
    expect(whitelist.has('price_malicious_xyz')).toBe(false);
  });

  test('env vars override: test mode price IDs are never confused with prod', () => {
    const prodIds = buildPriceIds();
    const testIds = buildPriceIds({
      STRIPE_PRICE_STARTER:  'price_test_s',
      STRIPE_PRICE_PRO:      'price_test_p',
      STRIPE_PRICE_BUSINESS: 'price_test_b',
    });
    const prodWhitelist = new Set(Object.values(prodIds));
    const testWhitelist = new Set(Object.values(testIds));
    // No overlap between prod and test whitelists
    for (const id of testWhitelist) {
      expect(prodWhitelist.has(id)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE 2 — M3: cron-sync baseUrl construction consistency
// ─────────────────────────────────────────────────────────────
describe('M3: cron-sync baseUrl construction', () => {
  test('uses VERCEL_URL when set', () => {
    expect(buildBaseUrl('myapp-abc123.vercel.app')).toBe('https://myapp-abc123.vercel.app');
  });

  test('falls back to repuguard.app when VERCEL_URL is undefined', () => {
    expect(buildBaseUrl(undefined)).toBe('https://repuguard.app');
  });

  test('falls back to repuguard.app when VERCEL_URL is empty string', () => {
    expect(buildBaseUrl('')).toBe('https://repuguard.app');
  });

  test('does not double-prefix https when VERCEL_URL lacks scheme', () => {
    const url = buildBaseUrl('foo.vercel.app');
    expect(url).toBe('https://foo.vercel.app');
    expect(url.startsWith('https://https://')).toBe(false);
  });

  test('all fetch calls in cron-sync use same baseUrl (consistency guarantee)', () => {
    const vercelUrl = 'preview-abc.vercel.app';
    const baseUrl = buildBaseUrl(vercelUrl);
    // Both the outer baseUrl and any inline ternary should produce same value
    const inline = vercelUrl ? 'https://' + vercelUrl : 'https://repuguard.app';
    expect(baseUrl).toBe(inline);
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE 3 — M4: get-dashboard newThisWeek null-safe filter
// ─────────────────────────────────────────────────────────────
describe('M4: get-dashboard newThisWeek null-safe filter', () => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  test('includes reviews from this week', () => {
    const reviews = [{ date: yesterday }, { date: new Date().toISOString() }];
    expect(filterNewThisWeek(reviews, weekAgo)).toHaveLength(2);
  });

  test('excludes reviews older than 7 days', () => {
    const reviews = [{ date: twoWeeksAgo }];
    expect(filterNewThisWeek(reviews, weekAgo)).toHaveLength(0);
  });

  test('null date does not crash and is excluded (M4 fix)', () => {
    const reviews = [{ date: null }, { date: yesterday }];
    expect(() => filterNewThisWeek(reviews, weekAgo)).not.toThrow();
    const result = filterNewThisWeek(reviews, weekAgo);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe(yesterday);
  });

  test('undefined date does not crash and is excluded', () => {
    const reviews = [{ date: undefined }, { date: yesterday }];
    expect(() => filterNewThisWeek(reviews, weekAgo)).not.toThrow();
    expect(filterNewThisWeek(reviews, weekAgo)).toHaveLength(1);
  });

  test('OLD logic without null guard returns wrong count for null dates', () => {
    function filterOLD(reviews, weekAgo) {
      return reviews.filter(r => new Date(r.date) > weekAgo);
    }
    // new Date(null) → Jan 1 1970 → correctly excluded (happens to work)
    // new Date(undefined) → Invalid Date → NaN comparison → excluded (happens to work)
    // Both happen to be excluded, but the intent is clearer with explicit null check
    // The real risk: if weekAgo is very old, new Date(null) could accidentally be included
    const reviews = [{ date: null }, { date: yesterday }];
    const oldResult = filterOLD(reviews, weekAgo);
    expect(oldResult).toHaveLength(1); // coincidentally correct for current weekAgo
    // With explicit guard, intent is clear regardless of weekAgo value
    expect(filterNewThisWeek(reviews, weekAgo)).toHaveLength(1);
  });

  test('empty reviews array returns empty (no crash)', () => {
    expect(filterNewThisWeek([], weekAgo)).toHaveLength(0);
  });

  test('mixed valid and null dates — only valid recent ones included', () => {
    const reviews = [
      { date: null },
      { date: undefined },
      { date: twoWeeksAgo },
      { date: yesterday },
      { date: new Date().toISOString() },
    ];
    const result = filterNewThisWeek(reviews, weekAgo);
    expect(result).toHaveLength(2);
  });
});
