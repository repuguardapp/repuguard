-- RepuGuard V2 — initial schema
-- Migration: 0001_init

-- ─── Extensions ─────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── organizations ───────────────────────────────────────────────────────────
create table organizations (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

alter table organizations enable row level security;

create policy "owner can select own org"
  on organizations for select
  using (owner_id = auth.uid());

create policy "owner can update own org"
  on organizations for update
  using (owner_id = auth.uid());

create policy "owner can insert org"
  on organizations for insert
  with check (owner_id = auth.uid());

-- ─── plans ───────────────────────────────────────────────────────────────────
create table plans (
  id                text primary key,
  name              text not null,
  max_platforms     smallint not null,
  max_locations     smallint not null,
  reviews_per_sync  smallint not null,
  sync_interval_h   smallint not null,
  ai_responses      boolean not null default false,
  email_alerts      boolean not null default false,
  white_label       boolean not null default false
);

alter table plans enable row level security;

create policy "plans are public"
  on plans for select
  using (true);

-- ─── subscriptions ───────────────────────────────────────────────────────────
create table subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null unique references organizations(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  plan                   text not null references plans(id),
  status                 text not null,
  trial_ends_at          timestamptz,
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

alter table subscriptions enable row level security;

create policy "org owner can select subscription"
  on subscriptions for select
  using (org_id in (select id from organizations where owner_id = auth.uid()));

-- ─── platform_connections ────────────────────────────────────────────────────
create table platform_connections (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  platform     text not null,
  external_id  text not null,
  display_name text,
  location     text,
  country      text,
  language     text not null default 'en',
  active       boolean not null default true,
  last_synced_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (org_id, platform, external_id)
);

alter table platform_connections enable row level security;

create policy "org owner can select connections"
  on platform_connections for select
  using (org_id in (select id from organizations where owner_id = auth.uid()));

create policy "org owner can insert connections"
  on platform_connections for insert
  with check (org_id in (select id from organizations where owner_id = auth.uid()));

create policy "org owner can update connections"
  on platform_connections for update
  using (org_id in (select id from organizations where owner_id = auth.uid()));

create policy "org owner can delete connections"
  on platform_connections for delete
  using (org_id in (select id from organizations where owner_id = auth.uid()));

-- ─── reviews ─────────────────────────────────────────────────────────────────
create table reviews (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  platform        text not null,
  external_id     text not null,
  author          text,
  rating          smallint not null check (rating between 1 and 5),
  body            text,
  published_at    timestamptz,
  is_negative     boolean generated always as (rating <= 3) stored,
  needs_response  boolean not null default false,
  responded_at    timestamptz,
  response_text   text,
  created_at      timestamptz not null default now(),
  unique (org_id, platform, external_id)
);

alter table reviews enable row level security;

create policy "org owner can select reviews"
  on reviews for select
  using (org_id in (select id from organizations where owner_id = auth.uid()));

create policy "org owner can update reviews"
  on reviews for update
  using (org_id in (select id from organizations where owner_id = auth.uid()));

-- ─── stripe_events (idempotency) ─────────────────────────────────────────────
create table stripe_events (
  id         text primary key,
  created_at timestamptz not null default now()
);

alter table stripe_events enable row level security;

-- ─── error_logs ──────────────────────────────────────────────────────────────
create table error_logs (
  id         uuid primary key default gen_random_uuid(),
  source     text not null,
  message    text not null,
  payload    jsonb,
  created_at timestamptz not null default now()
);

alter table error_logs enable row level security;
