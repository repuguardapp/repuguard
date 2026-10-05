import { expect, test } from '@playwright/test';

/**
 * The audit surface, as an anonymous visitor actually meets it.
 *
 * THIS FILE USED TO TEST SOMETHING THAT NO LONGER EXISTS
 *
 * It drove upload → tracking → completed against /en/audit with
 * /api/audit/async mocked, and it was written when that page was open to
 * anyone. The page now answers 307 to /en/login?next=/en/audit, so
 * `input[type="file"]` was never going to appear and the two tests spent
 * thirty seconds each waiting for it. They failed on every run for five
 * months and told nobody anything, because the suite as a whole could
 * not start at all.
 *
 * WHAT IS COVERED NOW, AND WHAT IS NOT
 *
 * The guard is covered: the route is private, and it carries the
 * visitor's destination so signing in returns them to it. That is a real
 * property and it is the one an anonymous visitor can observe.
 *
 * The upload flow is NOT covered end to end any more, and pretending
 * otherwise with a test that cannot reach it is worse than the gap. It
 * needs an authenticated session, which means a seeded Supabase the CI
 * job deliberately does not have — the whole suite runs without secrets.
 * The form's own logic is held by unit tests (audit-size-limits,
 * audit-framework-scope, audit-ownership, audit-replay-guard); what is
 * missing is the browser-level assembly of those parts.
 */
test.describe('Audit form', () => {
  test('/en/audit is private and keeps the destination', async ({ page }) => {
    await page.goto('/en/audit');

    await expect(page).toHaveURL(/\/en\/login/);
    // The `next` parameter is the difference between a login that
    // returns you to what you asked for and one that drops you on a
    // dashboard having forgotten why you came.
    expect(new URL(page.url()).searchParams.get('next')).toBe('/en/audit');
  });

  test('the login page it lands on is usable', async ({ page }) => {
    // A guard that redirects to a broken page is a guard that locks the
    // product rather than protecting it.
    await page.goto('/en/audit');
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
});
