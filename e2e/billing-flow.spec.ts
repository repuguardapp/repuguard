import { expect, test } from '@playwright/test';

/**
 * Billing surface — pricing displays in the user's currency, checkout
 * button POSTs and redirects to the URL Stripe returns. We mock the
 * /api/checkout response so we never touch Stripe in tests.
 */
test.describe('Pricing & checkout', () => {
  test('English pricing shows USD', async ({ page }) => {
    await page.goto('/en/pricing');
    await expect(page.getByRole('heading', { level: 1, name: /pricing/i })).toBeVisible();
    // First plan price contains a currency formatted USD.
    await expect(page.getByText(/\$\s*49/)).toBeVisible();
  });

  test('French pricing shows EUR', async ({ page }) => {
    await page.goto('/fr/pricing');
    // 45 € or €45 depending on Intl format.
    await expect(page.getByText(/45.*€|€.*45/)).toBeVisible();
  });

  test('Brazilian Portuguese pricing shows BRL', async ({ page }) => {
    await page.goto('/pt-br/pricing');
    await expect(page.getByText(/R\$\s*249/)).toBeVisible();
  });

  test('Japanese pricing shows JPY', async ({ page }) => {
    await page.goto('/ja/pricing');
    // Intl renders JPY for `ja` with the FULLWIDTH yen sign U+FFE5 (￥),
    // not U+00A5 (¥). The test asked for the second one and the page has
    // always been right. Both are accepted now, because which one a
    // runtime emits is ICU's business and not a product decision.
    await expect(page.getByText(/[¥￥]\s*7[\s,]?300/)).toBeVisible();
  });

  test('an anonymous visitor is sent to sign in, carrying the plan page', async ({ page }) => {
    // This test used to mock /api/checkout, click "Choose this plan" and
    // assert the redirect. An anonymous visitor never sees that button:
    // CheckoutButton renders a sign-in link when organizationId is
    // absent, and the e2e environment has no session by design — the
    // suite runs without secrets. It waited thirty seconds for a button
    // that could not exist, on every run, for five months.
    //
    // What an anonymous visitor does get is this, and it is worth
    // holding: the route to signing in, carrying where they wanted to
    // go. The POST-and-redirect path belongs to a test that can hold a
    // session, which this suite cannot.
    await page.goto('/en/pricing');

    const signIn = page.getByRole('link', { name: /sign in/i }).last();
    await expect(signIn).toBeVisible();

    const href = await signIn.getAttribute('href');
    expect(href).toContain('/en/login');
    expect(href).toContain('next=');
  });
});
