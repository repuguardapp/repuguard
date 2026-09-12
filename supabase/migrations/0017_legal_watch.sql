-- 0017 — the legal-watch corpus.
--
-- Foundation of the Acquisition brain: a durable, deduplicated record
-- of regulatory developments (enforcement decisions, guidance, court
-- rulings) across the regimes LexyFlow audits, which later becomes
-- programmatic SEO pages in seven languages.
--
-- Two design constraints drive this schema, and both are about not
-- destroying the site we already have.
--
-- COPYRIGHT. We do not store or republish source prose. Facts — which
-- authority, which date, which article, how much, what outcome — are
-- not protected by copyright, and a link to the primary source is what
-- makes a page trustworthy anyway. `raw_title` and `raw_excerpt` exist
-- only as extraction INPUT and are never rendered. Every source row
-- carries the licence we are operating under, in writing, because
-- "we assumed it was fine" is not a defence a compliance company
-- survives.
--
-- EDITORIAL CONTROL. Nothing reaches the public web without a human
-- approving it. Google's scaled-content-abuse policy applies
-- site-wide, not page-wide: an auto-published farm would put the ~266
-- pages that already rank at risk. And we would be a compliance
-- company publishing unreviewed legal claims under its own brand —
-- the exact "confidently wrong" failure we spent four days removing
-- from the product, moved onto the open internet. Hence the status
-- machine below, where `published` is only ever reached by hand.

create table if not exists public.legal_sources (
  id            text primary key,
  name          text        not null,
  jurisdiction  text        not null,
  -- Which of our framework ids this source informs. Lets a development
  -- deep-link into /audit with the right boxes already ticked.
  framework_ids text[]      not null default '{}',
  feed_url      text        not null,
  feed_kind     text        not null default 'rss'
                check (feed_kind in ('rss', 'atom')),
  -- Free text on purpose: the answer is rarely an SPDX identifier.
  -- "EU Decision 2011/833 — reuse permitted with attribution" and
  -- "CC BY-NC-SA 4.0 — NOT usable commercially" are both real answers
  -- and both need to be readable by a human.
  licence       text        not null,
  enabled       boolean     not null default true,
  last_polled_at timestamptz,
  last_status    text,
  last_error     text,
  created_at    timestamptz not null default now()
);

comment on column public.legal_sources.licence is
  'What we are permitted to do with this source, in plain words. A source whose licence forbids commercial reuse must be disabled, not merely noted.';

create table if not exists public.legal_developments (
  id            uuid primary key default gen_random_uuid(),
  source_id     text        not null references public.legal_sources(id) on delete cascade,
  -- The feed's own identifier. Paired with source_id it is what makes
  -- polling idempotent: the same item found on a hundred consecutive
  -- runs inserts once.
  external_id   text        not null,
  primary_url   text        not null,
  published_at  timestamptz,

  -- Extraction input. Never rendered, never indexed — see the
  -- copyright note above.
  raw_title     text        not null,
  raw_excerpt   text,

  status        text        not null default 'discovered'
                check (status in ('discovered', 'extracted', 'approved', 'published', 'rejected')),

  -- Structured facts, filled by the extraction pass. Facts, not prose.
  authority     text,
  decision_date date,
  articles      text[],
  fine_eur      numeric(14, 2),
  outcome       text,
  -- Our own one-paragraph summary in the English pivot, written by us
  -- from the primary source. Localised into the other six languages by
  -- the same Multi-Pass engine the audits use.
  summary_en    text,
  slug          text unique,

  rejected_reason text,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (source_id, external_id)
);

-- The review queue, which is the only screen a human has to look at.
create index if not exists legal_developments_status_idx
  on public.legal_developments (status, published_at desc nulls last);

-- Lookup by framework for the page that lists a regime's decisions.
create index if not exists legal_developments_source_idx
  on public.legal_developments (source_id, published_at desc nulls last);

create table if not exists public.legal_development_locales (
  development_id uuid not null references public.legal_developments(id) on delete cascade,
  locale         text not null,
  title          text not null,
  summary        text not null,
  created_at     timestamptz not null default now(),
  primary key (development_id, locale)
);

-- Service-role only. These tables are written by cron and read by the
-- public site through the service client; no end user touches them
-- directly, so RLS stays on with no policy rather than off.
alter table public.legal_sources            enable row level security;
alter table public.legal_developments       enable row level security;
alter table public.legal_development_locales enable row level security;

-- Seed. Only sources whose licence permits commercial reuse.
--
-- GDPRhub is deliberately ABSENT despite being the obvious choice: it
-- is CC BY-NC-SA 4.0, and the NC makes it unusable for a commercial
-- SaaS. Its API is also approval-gated. Adding it would put us in
-- breach of a content licence while selling compliance software.
--
-- Feed URLs are seeded enabled. The poller records last_status and
-- last_error per source and alerts, so a URL that has moved announces
-- itself on the first run instead of failing quietly.
insert into public.legal_sources (id, name, jurisdiction, framework_ids, feed_url, feed_kind, licence)
values
  ('edpb', 'European Data Protection Board', 'EU', array['gdpr'],
   'https://www.edpb.europa.eu/feed_en', 'rss',
   'EU institutional content — reuse permitted with attribution (Decision 2011/833/EU).'),
  ('cnil', 'CNIL (France)', 'FR', array['gdpr'],
   'https://www.cnil.fr/fr/rss.xml', 'rss',
   'French public-sector information — reuse permitted with attribution (Licence Ouverte / Etalab 2.0).'),
  ('ico', 'ICO (United Kingdom)', 'UK', array['uk_gdpr'],
   'https://ico.org.uk/rss/news-and-blogs/', 'rss',
   'UK public-sector information — Open Government Licence v3.0, commercial reuse permitted with attribution.'),
  ('eurlex_ai_act', 'EUR-Lex — EU AI Act', 'EU', array['eu_ai_act'],
   'https://eur-lex.europa.eu/EN/display-feed.rss?myRssId=Y3JpdGVyaWE9U1JDX0NFTEVYJTNBMzIwMjRSMTY4OQ%3D%3D', 'rss',
   'EUR-Lex — reuse permitted with attribution (Decision 2011/833/EU).')
on conflict (id) do nothing;
