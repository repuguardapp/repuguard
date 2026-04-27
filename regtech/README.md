# Global RegTech — Vision 6

> **Continuous compliance audits, delivered in any language.**
> Native support for 6 markets · on-demand reports in any BCP-47 language
> via the Multi-Pass engine · Zero-Knowledge by design.

[![Stack](https://img.shields.io/badge/stack-Next.js%2014%20·%20TypeScript%20·%20Supabase-1f6feb)](#stack)
[![i18n](https://img.shields.io/badge/i18n-EN%20·%20FR%20·%20ES%20·%20DE%20·%20PT--BR%20·%20JA-success)](#internationalisation-strategy)
[![Frameworks](https://img.shields.io/badge/frameworks-GDPR%20·%20AI%20Act%20·%20LGPD%20·%20APPI-orange)](#regulatory-coverage)
[![Compliance](https://img.shields.io/badge/privacy-Zero--Knowledge-black)](#zero-knowledge-guarantee)

---

## 1. Vision 6

Global RegTech is a SaaS platform that audits a controller's privacy
documents — policies, contracts, model cards, DPIAs — against the world's
major data and AI regulations, then delivers a board-ready report **in
the auditor's language of choice**.

Six market pillars define the product surface:

| # | Pillar               | What it means in practice |
|---|----------------------|---------------------------|
| 1 | **Multi-jurisdiction** | One audit run cross-references every regulation that applies to the controller, not just one. |
| 2 | **Multi-lingual UI**   | Six native languages (EN, FR, ES, DE, PT-BR, JA) with first-class typography and copy. |
| 3 | **Multi-Pass reports** | The audit logic runs once in a canonical pivot language; localization is a second pass that can target *any* BCP-47 tag. |
| 4 | **Multi-currency billing** | Stripe Billing checkout in the customer's currency (USD, EUR, BRL, JPY, GBP) with worldwide tax automation. |
| 5 | **Multi-tenant by default** | Row-Level Security on every table, organization-scoped JWTs, no shared state. |
| 6 | **Multi-runtime** | Edge for the locale-aware shell, Node.js for long-running audits, async fire-and-forget for documents at the size limit. |

---

## 2. Target markets

| Market | Locale  | Currency | Primary frameworks         |
|--------|---------|----------|----------------------------|
| US     | `en`    | USD      | CCPA / CPRA                |
| UK     | `en`    | GBP      | UK GDPR + DPA 2018         |
| EU FR  | `fr`    | EUR      | GDPR + EU AI Act           |
| EU ES  | `es`    | EUR      | GDPR + EU AI Act           |
| EU DE  | `de`    | EUR      | GDPR + EU AI Act           |
| Brazil | `pt-br` | BRL      | LGPD                       |
| Japan  | `ja`    | JPY      | APPI                       |

Auxiliary markets (CA, AU, MX, AR…) inherit a native locale and a tailored
framework set via `supabase/migrations/0002_seed_frameworks.sql`.

---

## 3. Regulatory coverage

| ID         | Regulation                                                | Authority                              |
|------------|-----------------------------------------------------------|----------------------------------------|
| `gdpr`     | General Data Protection Regulation                        | European Data Protection Board         |
| `eu_ai_act`| EU AI Act (Regulation 2024/1689)                          | European AI Office                     |
| `lgpd`     | Lei Geral de Proteção de Dados                            | ANPD                                   |
| `appi`     | Act on the Protection of Personal Information             | PPC                                    |
| `ccpa`     | California Consumer Privacy Act / CPRA                    | California Privacy Protection Agency   |
| `pipeda`   | Personal Information Protection and Electronic Documents Act | OPC                                  |
| `uk_gdpr`  | UK GDPR + Data Protection Act 2018                        | ICO                                    |

Adding a new framework is a four-line change in `src/lib/legal-frameworks.ts`
plus a row in the seed migration. The Multi-Pass prompt picks it up
automatically.

---

## 4. Stack

| Layer        | Choice                                 | Why |
|--------------|----------------------------------------|-----|
| **Frontend** | Next.js 14 (App Router) + TypeScript strict + Tailwind | Edge-native i18n routing, RTL-ready logical CSS properties. |
| **i18n**     | `next-intl`                            | Server-component-first, dictionary-per-locale, zero-code language addition. |
| **AI — Pass 1** | Anthropic Claude 3.5 Sonnet         | Long-context legal reasoning, citation-faithful JSON. |
| **AI — Pass 2** | OpenAI GPT-4o                       | Broadest BCP-47 language coverage for the localization pass. |
| **Database** | Supabase (Postgres + RLS + Auth)       | First-party JWT tenant claims, edge-friendly REST. |
| **Billing**  | Stripe Billing + Stripe Tax            | Multi-currency Prices, automatic VAT/GST/CT, tax-ID collection. |
| **Hosting**  | Vercel (Edge + Node Functions)         | Edge for routing/i18n, Node for the 60s+ audit pipeline. |

---

## 5. Multi-Pass engine

```
        ┌──────────────────────────┐
        │  Document (in memory)    │   ← never written to disk
        └────────────┬─────────────┘
                     │
                     ▼
        ┌──────────────────────────┐
        │  Pass 1 — legalAudit()   │   model: Claude 3.5 Sonnet
        │  pivot language: English │   output: structured JSON
        │  citations: verbatim     │
        └────────────┬─────────────┘
                     │
                     ▼
        ┌──────────────────────────┐
        │  Pass 2 — localizeReport()│  model: GPT-4o
        │  any BCP-47 target        │  preserves citations & evidence
        └────────────┬─────────────┘
                     │
                     ▼
        ┌──────────────────────────┐
        │   AuditReport (signed)   │   stored: hash + report only
        └──────────────────────────┘
```

Two passes, two reasons:

1. **Caching** — pass 1 is the expensive step. We cache it per
   `documentHash` and re-run pass 2 on demand for the marginal cost of a
   translation call.
2. **Faithfulness** — citations, statute numbers, and verbatim evidence
   stay in the regulation's source language. The localization pass is
   *not* allowed to touch them.

Implementation: [`src/lib/multi-pass-engine.ts`](./src/lib/multi-pass-engine.ts).

---

## 6. Internationalisation strategy

```
messages/
├── en.json        ← native, curated copy
├── fr.json
├── es.json
├── de.json
├── pt-br.json
├── ja.json
└── ar.json        ← drop-in: Arabic ships with no source change
```

* `discoverLocales()` walks `messages/` at request time. Adding `ar.json`,
  `it.json`, or `vi.json` ships that language to production immediately.
* `<html lang>` and `<html dir>` are set per locale layout. RTL flips
  through CSS logical properties (`pis`, `pie`, `border-is`,
  `border-ie`) baked into Tailwind utilities.
* Long-text safety: the hero, buttons and cards are tested with German
  (~+30% length) and Japanese line-break rules. `text-balance` and
  `text-pretty` keep multi-line copy visually clean.
* `LanguageSelector` only lists the six native locales — auxiliary
  languages flow through pass 2 for **report content**, not chrome.

---

## 7. Zero-Knowledge guarantee

* Source documents live as `Buffer` instances in request scope only.
* `withEphemeralDocument()` calls `Buffer.fill(0)` on every exit path
  (success, throw, cancellation) before the slab is GC'd.
* Postgres stores **only** the SHA-256 hash and the AI-authored report.
  The original text never lands on disk.
* `anonymize()` is offered for the secondary path where a customer asks
  to keep documents in their workspace; it strips email, phone, IBAN,
  CPF, SSN and PAN-style sequences before storage.

Implementation: [`src/lib/zero-knowledge.ts`](./src/lib/zero-knowledge.ts).

---

## 8. SEO & discoverability

* `buildHreflangAlternates()` emits one `<link rel="alternate">` per
  discovered locale plus `x-default`.
* `app/sitemap.ts` produces a multilingual sitemap with `alternates.languages`
  for each canonical path.
* `robots.ts` exposes the sitemap; canonical URLs are locale-prefixed.

---

## 9. Getting started

```bash
cp .env.example .env.local   # fill in Supabase, Anthropic, OpenAI, Stripe
npm install
npm run dev                  # http://localhost:3000
```

Run the SQL migrations under `supabase/migrations/` against your
Supabase project, in numerical order.

```bash
npm test                     # Vitest: locale detection, frameworks,
                             #         hreflang, Zero-Knowledge primitives
npm run typecheck            # tsc --noEmit, strict mode
```

---

## 10. Roadmap

- [x] Multi-Pass engine (Claude pass 1 → GPT-4o pass 2)
- [x] 6 native locales + dynamic locale discovery
- [x] Stripe Billing with multi-currency + tax automation
- [x] Zero-Knowledge document handling
- [x] Hreflang + multilingual sitemap
- [ ] PDF report rendering with locale-aware typography (Noto + Source Han)
- [ ] DPIA wizard (interactive, multi-step, locale-aware)
- [ ] Continuous monitoring (re-audit on document update)
- [ ] SOC 2 Type II artefacts
- [ ] Public API + webhook delivery of findings

---

## 11. License

Proprietary — © RepuGuard Compliance. All rights reserved.
