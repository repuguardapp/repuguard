# RepuGuard

SaaS platform for real-time online reputation monitoring. Automatically fetches reviews from Google, Trustpilot, and TripAdvisor, generates AI-powered response drafts, and sends alerts via email and webhook.

## Architecture

```
Browser / Dashboard
       │
       ▼
  Vercel (repuguard.app)
  ├── /api/* — 10 Edge Runtime functions (auth, AI generation, dashboard, i18n…)
  └── /api/* — 11 Node.js Serverless functions (Stripe, cron, email, webhooks…)
       │
       ├── Supabase (PostgreSQL + Auth)
       │   └── Tables: clients, reviews, processed_webhook_events, error_logs
       │
       ├── Stripe — subscription billing (webhook → /api/stripe-webhook)
       │
       ├── Anthropic API — AI response generation (Claude Haiku)
       │
       ├── Resend — transactional email (alerts, onboarding sequences, weekly reports)
       │
       └── External review APIs
           ├── Google Places API (primary — fetched every day at 07:00 UTC)
           ├── Trustpilot Content API
           └── TripAdvisor Content API
```

### Cron schedule

`vercel.json` configures a daily cron at `0 7 * * *` (07:00 UTC) that calls `/api/cron-sync`.  
This single job handles Google + Trustpilot + TripAdvisor review fetching and all onboarding email sequences (J1–J7).

### Edge vs Node.js functions

| Runtime | Files |
|---------|-------|
| **Edge** | `auth`, `chat`, `generate-response`, `get-dashboard`, `google-oauth-init`, `newsletter`, `reset-password`, `translate`, `update-client`, `update-review` |
| **Node.js** | `contact`, `create-subscription`, `cron-sync`, `customer-portal`, `fetch-reviews`, `google-oauth-callback`, `publish-review-reply`, `send-email`, `send-webhook`, `stripe-webhook`, `unsubscribe` |

> Vercel Hobby plan limit: 12 Node.js Serverless Functions. Current count: **11** (within limit).

---

## Environment Variables

All variables must be set in the Vercel project settings under **Settings → Environment Variables**.

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ | Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_SECRET_KEY` | ✅ | Supabase service role key (bypasses RLS) |
| `STRIPE_SECRET_KEY` | ✅ | Stripe secret key (`sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe webhook signing secret (`whsec_…`) |
| `STRIPE_PRICE_STARTER` | ✅ | Stripe Price ID for the Starter plan |
| `STRIPE_PRICE_PRO` | ✅ | Stripe Price ID for the Pro plan |
| `STRIPE_PRICE_BUSINESS` | ✅ | Stripe Price ID for the Business plan |
| `GOOGLE_PLACES_API_KEY` | ✅ | Google Places API key (for review fetching) |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth client ID (for GBP reply publishing) |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth client secret |
| `TOKEN_ENCRYPTION_KEY` | ✅ | 32-char secret for encrypting GBP OAuth tokens at rest |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic API key for Claude Haiku response generation |
| `RESEND_API_KEY` | ✅ | Resend API key for transactional email |
| `CRON_SECRET` | ✅ | Bearer secret authenticating cron and internal API-to-API calls |
| `TRUSTPILOT_API_KEY` | ✅ | Trustpilot Content API key |
| `TRIPADVISOR_API_KEY` | ✅ | TripAdvisor Content API key |
| `ADMIN_EMAIL` | ✅ | Admin email address (contact form recipient) |
| `ANTHROPIC_API_VERSION` | ⬜ | Anthropic API version header (default: `2023-06-01`) |
| `VERCEL_URL` | auto | Set automatically by Vercel — used to build internal API base URLs |

---

## Running Tests Locally

```bash
# Install dependencies
npm install

# Run the full test suite once
npm test

# Watch mode (re-runs on file save)
npm run test:watch
```

Tests are written with [Vitest](https://vitest.dev/) and located in the `tests/` directory:

| File | Coverage |
|------|---------|
| `tests/batch-4.1.test.js` | Subscription guard, plan mapping, Stripe price fallbacks, GBP publisher |
| `tests/batch-4.2.test.js` | `autoRespond5star` logic (H4), GBP review matching (C5), Anthropic version env var (H5), fire-and-forget pattern |
| `tests/batch-4.3.test.js` | Stripe price IDs env var override (M2), `baseUrl` construction (M3), null-safe date filter (M4) |

All 85 tests must pass before any push to `main`. The GitHub Actions workflow enforces this automatically.

---

## Database Migrations

SQL migration files are in `migrations/`. Run them in order against your Supabase project via the SQL editor or Supabase CLI:

```bash
# Example using psql
psql "$DATABASE_URL" -f migrations/001_add_columns.sql
psql "$DATABASE_URL" -f migrations/002_add_lang.sql
# … up to the latest migration
```

Row-Level Security is enabled on all tables (`migrations/006_enable_rls.sql`). All server-side access uses the service role key which bypasses RLS.

---

## Deployment

1. Push to `main` — Vercel auto-deploys on every merge.
2. Stripe webhook endpoint: `https://repuguard.app/api/stripe-webhook`  
   Required events: `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`
3. Vercel cron (`vercel.json`) runs `/api/cron-sync` daily at 07:00 UTC — no manual setup needed.
