import { expect, test } from '@playwright/test';

/**
 * These four pages are the legal surface. The test is that each one
 * renders its own h1 — not that it renders a particular sentence.
 *
 * `/integrations & sub-processors/i` was hardcoded here and the copy
 * became "Integrations and sub-processors", so the suite failed for five
 * months on a page that was working. The regexes below match the part of
 * each title that identifies the document, and deliberately not the
 * connectives and parentheses an editor is free to change.
 */
const LEGAL_PAGES = [
  { path: 'privacy', heading: /privacy policy/i },
  { path: 'terms', heading: /terms of service/i },
  { path: 'dpa', heading: /data processing agreement/i },
  { path: 'integrations', heading: /integrations (and|&) sub-processors/i }
];

test.describe('Legal & integrations pages', () => {
  for (const { path, heading } of LEGAL_PAGES) {
    test(`/en/${path} renders`, async ({ page }) => {
      await page.goto(`/en/${path}`);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    });
  }

  test('integrations page lists all sub-processors', async ({ page }) => {
    await page.goto('/en/integrations');
    for (const name of ['Anthropic', 'OpenAI', 'Supabase', 'Stripe', 'Vercel', 'Resend', 'Sentry']) {
      await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible();
    }
  });

  test('privacy mentions Zero-Knowledge', async ({ page }) => {
    await page.goto('/en/privacy');
    await expect(page.getByText(/zero-knowledge/i).first()).toBeVisible();
  });
});
