# RegTech Compliance Platform

International compliance audit platform — GDPR, EU AI Act, LGPD and APPI —
delivered with a multilingual UI and a Multi-Pass dynamic translation engine.

This is a **separate sub-project** under the existing `repuguard` monorepo. It
is intentionally isolated from the legacy static site so the two products can
ship independently.

## Architecture at a glance

```
                    ┌───────────────────────────┐
  Browser  ────►    │  Next.js 14 (App Router)  │
                    │  Edge middleware:         │
                    │   • locale detection      │
                    │   • Accept-Language + IP  │
                    └────────────┬──────────────┘
                                 │
            ┌────────────────────┴───────────────────────┐
            ▼                                            ▼
     /api/audit            /api/checkout
   ┌──────────────┐      ┌────────────────┐
   │ Multi-Pass    │      │ Stripe Billing │
   │ Pass 1: Claude│      │ + Stripe Tax   │
   │ Pass 2: GPT-4o│      │ multi-currency │
   └─────┬────────┘      └────────────────┘
         │
         ▼
   ┌──────────────┐
   │  Supabase    │  reports + findings only
   │  (no docs)   │  Zero-Knowledge: source wiped
   └──────────────┘
```

## i18n model

* `messages/<locale>.json` is the source of truth. The 6 native locales
  (`en`, `fr`, `es`, `de`, `pt-br`, `ja`) are checked into `messages/`.
* **Adding a 7th language requires no code change.** Drop
  `messages/it.json` (or any BCP-47 tag) and the loader picks it up:
    * `discoverLocales()` walks the directory at request time.
    * `sitemap.ts` and `buildHreflangAlternates()` emit the new locale.
    * Static-prefix locales remain the 6 in `NATIVE_LOCALE_CODES` (used
      by `generateStaticParams`); dynamically-discovered locales render
      via the dynamic segment without static generation.
* `LanguageSelector` shows only native locales because they have curated
  UI strings; auxiliary languages flow through pass 2 for **report
  content** while the chrome stays in a native language.

## Multi-Pass engine

`src/lib/multi-pass-engine.ts` exposes:

| Function          | Model                | Purpose                                          |
| ----------------- | -------------------- | ------------------------------------------------ |
| `legalAudit()`    | Claude 3.5 Sonnet    | Pass 1 — analyse the document in English (pivot). |
| `localizeReport()`| GPT-4o               | Pass 2 — translate the report to any language.    |
| `runMultiPassAudit()` | both             | Composes the two and shapes the final `AuditReport`. |

Citations and verbatim evidence are **not** translated — they remain in the
original language of the regulation.

## Zero-Knowledge document handling

* `withEphemeralDocument()` wraps every analysis call. It hashes the text,
  runs the work, and `Buffer.fill(0)`'s the source bytes on every exit
  path (success, throw, cancellation).
* The Supabase schema (`supabase/migrations/0001_init.sql`) only stores
  `document_hash` plus the AI-authored report. The original document
  text never lands in Postgres.
* `anonymize()` is offered for the secondary path where a customer asks
  to keep documents in their workspace; it strips email, phone, IBAN,
  CPF, SSN, and PAN-style sequences before storage.

## Stripe Billing

`src/lib/stripe.ts::createCheckoutSession` adapts:

* `currency` — picked from the locale descriptor (`USD`, `EUR`, `BRL`,
  `JPY`, `GBP`).
* `locale` — Stripe Checkout UI language, mapped from the user's BCP-47
  tag (`pt-br` → `pt-BR`, `ja` → `ja`).
* `automatic_tax: { enabled: true }` — Stripe Tax computes worldwide
  VAT/GST from the billing address.
* `tax_id_collection` — collects EU/BR/JP tax IDs at checkout.

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

Run the Supabase migrations under `supabase/migrations/` against your
project, in numerical order.

## Tests

```bash
npm test
```

Vitest exercises locale detection, framework mapping, hreflang
generation and Zero-Knowledge primitives. The AI passes are covered by
contract types but require live API keys to run end-to-end.
