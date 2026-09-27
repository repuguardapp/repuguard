-- The sample, and where it came from.
--
-- An observatory is worth exactly what its sample is worth. "The most
-- visited French sites" is a claim; "the .fr domains in Tranco list <id>
-- of <date>, ranks 1 to N" is a statement anybody can reproduce and
-- contest, which is the only kind worth publishing and the only kind that
-- gets cited.
--
-- So the population is derived from a named, dated, public research list
-- rather than assembled by us. We could not invent a credible ranking and
-- we are not going to: a sample we chose is a sample we chose to flatter
-- the result.
--
-- Tranco (tranco-list.eu) is the right source. It is free, academic,
-- published with a permanent identifier per list, and built precisely
-- because the commercial top-site lists are unstable and unciteable.

create table if not exists public.survey_domains (
  domain       text primary key,
  -- Rank within the source list, kept so the methodology can state the
  -- range and so a reader can check we took the top and not a selection.
  rank         integer not null,
  source       text not null default 'tranco',
  -- The list's permanent identifier and date. Without these the sample is
  -- unreproducible and the study is an anecdote.
  source_id    text not null,
  source_date  date not null,
  added_at     timestamptz not null default now()
);

create index if not exists survey_domains_rank_idx on public.survey_domains (rank);

comment on table public.survey_domains is
  'The observatory sample: .fr domains taken from a dated public ranking. source_id and source_date are what make the study reproducible.';

alter table public.survey_domains enable row level security;

-- Which scans belong to the study.
--
-- The survey writes to the same scans / scan_snapshots / scan_observations
-- tables as the public tool, deliberately: one pipeline, one set of
-- observations, one definition of what "present" means. A separate code
-- path would drift, and a study computed from a drifted copy of the
-- product is a study about something we do not sell.
--
-- The column only says who asked. A domain scanned by a visitor counts in
-- the statistics exactly the same way, and the study says so.
alter table public.scans
  add column if not exists origin text not null default 'public'
  check (origin in ('public', 'survey'));

create index if not exists scans_origin_idx on public.scans (origin, created_at desc);

comment on column public.scans.origin is
  'public = a visitor asked for it; survey = the observatory cron did. The observations themselves are identical.';
