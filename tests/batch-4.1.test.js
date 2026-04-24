import { describe, test, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────
// HELPERS UNDER TEST
// These mirror the pure logic in the production files.
// Any change to that logic must be reflected here.
// ─────────────────────────────────────────────────────────────

// Mirrors PRICE_TO_PLAN in stripe-webhook.js
const PROD_PRICE_IDS = {
  starter:  'price_1TJfMs4AfFLajYNswedRcOT5',
  pro:      'price_1TJfOW4AfFLajYNsmOvVBxGj',
  business: 'price_1TJfPU4AfFLajYNsJtTIsjl3',
};

function buildPriceToplan(env = {}) {
  return {
    [env.STRIPE_PRICE_STARTER || PROD_PRICE_IDS.starter]:  'starter',
    [env.STRIPE_PRICE_PRO     || PROD_PRICE_IDS.pro]:      'pro',
    [env.STRIPE_PRICE_BUSINESS|| PROD_PRICE_IDS.business]: 'business',
  };
}

function getPlanFromPriceId(priceId, map) {
  if (!priceId) return 'starter';
  return map[priceId] || 'starter';
}

// Mirrors checkAccess logic in generate-response.js and fetch-reviews*.js
function checkAccess(client) {
  const trialValid = client.trial_ends && new Date(client.trial_ends) > new Date();
  const subActive  = ['active', 'trialing'].includes(client.subscription_status);
  return trialValid || subActive;
}

// Mirrors plan default resolution everywhere
function resolvePlan(clientPlan) {
  return clientPlan || 'starter';
}

// Mirrors patch object built in stripe-webhook invoice.paid
function buildInvoicePatch(invoice, sub, priceMap) {
  const patch = {
    active: true,
    subscription_status: 'active',
    stripe_customer_id: invoice.customer,
  };
  if (sub?.current_period_end) {
    patch.current_period_end = new Date(sub.current_period_end * 1000).toISOString();
  }
  const priceId = sub?.items?.data?.[0]?.price?.id;
  patch.plan = getPlanFromPriceId(priceId, priceMap);
  return patch;
}

// Mirrors patch object built in customer.subscription.updated
function buildSubscriptionPatch(sub, priceMap) {
  const priceId = sub?.items?.data?.[0]?.price?.id;
  return {
    subscription_status: sub.status,
    active: sub.status === 'active' || sub.status === 'trialing',
    current_period_end: new Date((sub.current_period_end || 0) * 1000).toISOString(),
    plan: getPlanFromPriceId(priceId, priceMap),
  };
}

// ─────────────────────────────────────────────────────────────
// SUITE 1 — Stripe price_id → plan mapping
// ─────────────────────────────────────────────────────────────
describe('Stripe price_id → plan mapping', () => {
  const map = buildPriceToplan();

  test('maps starter price ID to starter', () => {
    expect(getPlanFromPriceId(PROD_PRICE_IDS.starter, map)).toBe('starter');
  });

  test('maps pro price ID to pro', () => {
    expect(getPlanFromPriceId(PROD_PRICE_IDS.pro, map)).toBe('pro');
  });

  test('maps business price ID to business', () => {
    expect(getPlanFromPriceId(PROD_PRICE_IDS.business, map)).toBe('business');
  });

  test('unknown price ID falls back to starter', () => {
    expect(getPlanFromPriceId('price_unknown_xyz', map)).toBe('starter');
  });

  test('undefined price ID falls back to starter', () => {
    expect(getPlanFromPriceId(undefined, map)).toBe('starter');
  });

  test('null price ID falls back to starter', () => {
    expect(getPlanFromPriceId(null, map)).toBe('starter');
  });

  test('env var override replaces hardcoded ID (test mode)', () => {
    const testMap = buildPriceToplan({
      STRIPE_PRICE_STARTER:  'price_test_starter',
      STRIPE_PRICE_PRO:      'price_test_pro',
      STRIPE_PRICE_BUSINESS: 'price_test_business',
    });
    expect(getPlanFromPriceId('price_test_pro',      testMap)).toBe('pro');
    expect(getPlanFromPriceId('price_test_starter',  testMap)).toBe('starter');
    expect(getPlanFromPriceId('price_test_business', testMap)).toBe('business');
    // Prod IDs should not match test map → fallback to starter
    expect(getPlanFromPriceId(PROD_PRICE_IDS.pro, testMap)).toBe('starter');
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE 2 — invoice.paid patch object (C4)
// ─────────────────────────────────────────────────────────────
describe('stripe-webhook invoice.paid patch', () => {
  const map = buildPriceToplan();
  const baseInvoice = { customer: 'cus_test123', subscription: 'sub_test' };
  const periodEnd = 1800000000; // future unix timestamp

  test('sets plan=pro when invoice is for pro price', () => {
    const sub = {
      current_period_end: periodEnd,
      items: { data: [{ price: { id: PROD_PRICE_IDS.pro } }] },
    };
    const patch = buildInvoicePatch(baseInvoice, sub, map);
    expect(patch.plan).toBe('pro');
    expect(patch.active).toBe(true);
    expect(patch.subscription_status).toBe('active');
    expect(patch.stripe_customer_id).toBe('cus_test123');
    expect(patch.current_period_end).toBeTruthy();
  });

  test('sets plan=business when invoice is for business price', () => {
    const sub = {
      current_period_end: periodEnd,
      items: { data: [{ price: { id: PROD_PRICE_IDS.business } }] },
    };
    expect(buildInvoicePatch(baseInvoice, sub, map).plan).toBe('business');
  });

  test('falls back to starter when price_id missing from subscription items', () => {
    const sub = { current_period_end: periodEnd, items: { data: [] } };
    expect(buildInvoicePatch(baseInvoice, sub, map).plan).toBe('starter');
  });

  test('handles subscription with no items field gracefully', () => {
    const sub = { current_period_end: periodEnd };
    expect(buildInvoicePatch(baseInvoice, sub, map).plan).toBe('starter');
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE 3 — customer.subscription.updated patch (C4)
// ─────────────────────────────────────────────────────────────
describe('stripe-webhook subscription.updated patch', () => {
  const map = buildPriceToplan();
  const periodEnd = 1800000000;

  test('sets plan=pro on active subscription update', () => {
    const sub = {
      status: 'active',
      current_period_end: periodEnd,
      items: { data: [{ price: { id: PROD_PRICE_IDS.pro } }] },
    };
    const patch = buildSubscriptionPatch(sub, map);
    expect(patch.plan).toBe('pro');
    expect(patch.active).toBe(true);
    expect(patch.subscription_status).toBe('active');
  });

  test('sets active=true for trialing status', () => {
    const sub = {
      status: 'trialing',
      current_period_end: periodEnd,
      items: { data: [{ price: { id: PROD_PRICE_IDS.starter } }] },
    };
    const patch = buildSubscriptionPatch(sub, map);
    expect(patch.active).toBe(true);
    expect(patch.plan).toBe('starter');
  });

  test('sets active=false for cancelled status', () => {
    const sub = {
      status: 'cancelled',
      current_period_end: periodEnd,
      items: { data: [{ price: { id: PROD_PRICE_IDS.pro } }] },
    };
    const patch = buildSubscriptionPatch(sub, map);
    expect(patch.active).toBe(false);
    expect(patch.plan).toBe('pro');
  });

  test('plan falls back to starter when no price in items', () => {
    const sub = { status: 'active', current_period_end: periodEnd, items: { data: [] } };
    expect(buildSubscriptionPatch(sub, map).plan).toBe('starter');
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE 4 — Subscription access guard (C1 context + Batch 1)
// ─────────────────────────────────────────────────────────────
describe('Subscription access guard (checkAccess)', () => {
  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  const past   = new Date(Date.now() - 1 * 86400000).toISOString();

  test('active trial + no subscription → allowed', () => {
    expect(checkAccess({ trial_ends: future, subscription_status: null })).toBe(true);
  });

  test('expired trial + active subscription → allowed', () => {
    expect(checkAccess({ trial_ends: past, subscription_status: 'active' })).toBe(true);
  });

  test('expired trial + trialing → allowed', () => {
    expect(checkAccess({ trial_ends: past, subscription_status: 'trialing' })).toBe(true);
  });

  test('active trial + active subscription → allowed', () => {
    expect(checkAccess({ trial_ends: future, subscription_status: 'active' })).toBe(true);
  });

  test('expired trial + null subscription → blocked', () => {
    expect(checkAccess({ trial_ends: past, subscription_status: null })).toBe(false);
  });

  test('expired trial + cancelled → blocked', () => {
    expect(checkAccess({ trial_ends: past, subscription_status: 'cancelled' })).toBe(false);
  });

  test('expired trial + payment_failed → blocked', () => {
    expect(checkAccess({ trial_ends: past, subscription_status: 'payment_failed' })).toBe(false);
  });

  test('null trial_ends + active subscription → allowed', () => {
    expect(checkAccess({ trial_ends: null, subscription_status: 'active' })).toBe(true);
  });

  test('null trial_ends + null subscription → blocked', () => {
    expect(checkAccess({ trial_ends: null, subscription_status: null })).toBe(false);
  });

  test('empty string subscription_status → blocked (no trial)', () => {
    expect(checkAccess({ trial_ends: past, subscription_status: '' })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE 5 — Plan default resolution (C2, C3)
// ─────────────────────────────────────────────────────────────
describe('Plan default resolution (resolvePlan)', () => {
  test('null → starter', ()        => expect(resolvePlan(null)).toBe('starter'));
  test('undefined → starter', ()   => expect(resolvePlan(undefined)).toBe('starter'));
  test('empty string → starter', ()=> expect(resolvePlan('')).toBe('starter'));
  test('starter → starter', ()     => expect(resolvePlan('starter')).toBe('starter'));
  test('pro → pro', ()             => expect(resolvePlan('pro')).toBe('pro'));
  test('business → business', ()   => expect(resolvePlan('business')).toBe('business'));
  // Critical: must NEVER return 'pro' for a missing plan after Batch 4.1
  test('no implicit pro upgrade for null plan', () => {
    expect(resolvePlan(null)).not.toBe('pro');
    expect(resolvePlan(undefined)).not.toBe('pro');
  });
});

// ─────────────────────────────────────────────────────────────
// SUITE 6 — Dashboard trial banner (C1: RG.client bug)
// ─────────────────────────────────────────────────────────────
describe('Trial banner date calculation', () => {
  function daysLeftFromClient(client) {
    if (!client?.trial_ends) return 0;
    const trialEnd = new Date(client.trial_ends);
    const now = new Date();
    return Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
  }

  test('returns correct days left for future trial', () => {
    const sevenDays = new Date(Date.now() + 7 * 86400000).toISOString();
    const days = daysLeftFromClient({ trial_ends: sevenDays });
    expect(days).toBeGreaterThanOrEqual(6);
    expect(days).toBeLessThanOrEqual(8);
  });

  test('returns negative days for past trial (expired)', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    expect(daysLeftFromClient({ trial_ends: yesterday })).toBeLessThan(0);
  });

  test('returns 0 for null trial_ends (no crash)', () => {
    expect(daysLeftFromClient({ trial_ends: null })).toBe(0);
  });

  test('returns 0 when client is undefined (no crash — C1 fix)', () => {
    // Before fix: new Date(undefined.trial_ends) → TypeError
    // After fix: daysLeftFromClient called with destructured d.client → safe
    expect(() => daysLeftFromClient(undefined)).not.toThrow();
    expect(daysLeftFromClient(undefined)).toBe(0);
  });
});
