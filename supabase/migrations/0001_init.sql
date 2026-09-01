-- RepuGuard — schéma initial
-- Reconstruit à partir de l'usage réel des colonnes dans api/*.js et de
-- l'historique migrations/001-007 du dépôt sandbox (repuguardapp/repuguard).
-- Base propre pour un nouveau projet Supabase — à exécuter une seule fois,
-- dans l'éditeur SQL de Supabase, sur un projet vierge.

-- ── clients ──────────────────────────────────────────────────────────────
-- Un client = un compte business. id = auth.users.id (Supabase Auth).
create table if not exists clients (
  id                      uuid primary key references auth.users(id) on delete cascade,
  email                   text not null,
  first_name              text,
  last_name               text,
  business_name           text,
  sector                  text,
  country                 text,
  lang                    varchar(5) default 'fr',

  -- Plan & facturation
  plan                    text default 'starter',            -- starter | pro | business
  active                  boolean default true,
  trial_ends              timestamptz,
  subscription_status     text,                               -- active | trialing | payment_failed | cancelled
  stripe_customer_id      text,
  current_period_end      timestamptz,

  -- Quota de réponses IA (remis à zéro chaque jour, cf. api/generate-response.js)
  responses_today         integer default 0,
  responses_date          date,

  -- Sources d'avis connectées
  google_place_id         text,
  trustpilot_business_id  text,
  trustpilot_score        float,
  tripadvisor_location_id text,

  -- Google Business Profile OAuth (jeton chiffré AES-256-GCM — cf. TOKEN_ENCRYPTION_KEY)
  gbp_refresh_token       text,
  gbp_location_name       text,

  -- Alertes & automatisation
  webhook_url             text,
  webhook_enabled         boolean default false,
  auto_respond_5star      boolean default false,

  -- Parrainage & emailing
  referred_by             text,
  email_unsubscribed      boolean default false,

  created_at              timestamptz default now()
);

comment on column clients.gbp_refresh_token is
  'Chiffré AES-256-GCM, format iv:tag:ciphertext en hex. Voir api/publish-review-reply.js.';

-- ── reviews ──────────────────────────────────────────────────────────────
create table if not exists reviews (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients(id) on delete cascade,
  platform       text not null,                    -- google | trustpilot | tripadvisor
  review_id      text not null,                     -- id externe, dédoublonnage
  author         text,
  rating         numeric,
  text           text,
  date           timestamptz,
  is_negative    boolean default false,
  needs_response boolean default false,
  responded_at   timestamptz,
  created_at     timestamptz default now(),

  unique (review_id)
);

create index if not exists reviews_client_id_idx on reviews (client_id);
create index if not exists reviews_needs_response_idx on reviews (client_id, needs_response) where needs_response;

-- ── processed_webhook_events ─────────────────────────────────────────────
-- Déduplication des webhooks Stripe (cf. api/stripe-webhook.js).
create table if not exists processed_webhook_events (
  id         text primary key,
  created_at timestamptz default now()
);

-- ── error_logs ───────────────────────────────────────────────────────────
-- Suivi structuré des erreurs de production (cf. logError() dans chaque
-- fonction api/*.js).
create table if not exists error_logs (
  id         uuid primary key default gen_random_uuid(),
  source     text not null,
  message    text,
  context    jsonb,
  created_at timestamptz default now()
);

create index if not exists error_logs_created_at_idx on error_logs (created_at desc);

-- ── Row-Level Security ───────────────────────────────────────────────────
-- Tout l'accès applicatif passe par la clé service_role (qui contourne RLS).
-- Ceci bloque uniquement l'accès direct public/anon aux tables.
alter table clients enable row level security;
alter table reviews enable row level security;
alter table error_logs enable row level security;
alter table processed_webhook_events enable row level security;
