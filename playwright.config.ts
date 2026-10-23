import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Playwright config — boots `next start` against the production build,
 * runs the e2e/ specs, then tears it down.
 *
 * WHAT THIS SUITE REACHES, AND WHAT IT DOES NOT
 *
 * This comment used to say that calls to Stripe / Anthropic / Supabase
 * were "intercepted with route mocks — see `e2e/fixtures.ts`". There is
 * no `e2e/fixtures.ts`, and there never was one. The whole suite holds
 * a single route mock, inline in `auth-and-guards.spec.ts`. Nothing is
 * intercepted, because nothing gets that far.
 *
 * The suite runs without secrets, which is the real reason it is
 * deterministic — and the real limit. It stops at the login wall:
 * `/en/audit` answers 307, `CheckoutButton` renders a sign-in link with
 * no session, and both specs say so in their own headers. Every page
 * behind that wall is untested at browser level.
 *
 * That is where four of the five funnel defects found in October lived
 * — a dead-end scan result, a 404 on a new account's first report, an
 * unreachable free trial, a paywall a signed-in user could walk around.
 * This suite was green through all of them and would be green through
 * the next one. It is worth running and it is not coverage of the
 * funnel; closing that gap needs a database that is not production,
 * because seeding production would put false rows into the organisation
 * count the morning digest reports.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // An escape hatch for a machine that already has a browser.
        //
        // CI runs `playwright install` and leaves this unset, so nothing
        // changes there. A sandbox with Chromium pre-installed at a
        // version Playwright did not fetch sets it and runs the suite
        // instead of being told to download a browser it cannot
        // download. Five months of drift were invisible partly because
        // nobody could run this locally.
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {})
      }
    }
  ],
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Build-time / runtime defaults that keep the app rendering even
      // without real provider credentials.
      NEXT_PUBLIC_APP_URL: BASE,
      NEXT_PUBLIC_APP_NAME: 'LexyFlow',
      NEXT_PUBLIC_SUPABASE_URL: 'https://e2e.supabase.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key-not-real',
      DEFAULT_LOCALE: 'en'
    }
  }
});
