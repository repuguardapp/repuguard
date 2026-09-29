-- What the observatory's last run actually did.
--
-- legal_sources has carried last_status and last_error since the poller
-- was written, for exactly this reason: a job that fails needs to say so
-- somewhere a query can reach, not only somewhere a log search can.
--
-- The survey had nothing equivalent, so when it produced no domains for
-- two days the only way to find out was to read Vercel's runtime logs —
-- and the reason for the failure was travelling in an HTTP response body
-- that nothing read. Making it loud fixed the silence; this makes it
-- answerable without leaving the database.

create table if not exists public.survey_runs (
  id          uuid primary key default gen_random_uuid(),
  ran_at      timestamptz not null default now(),
  ok          boolean not null,
  -- Populated when the run could not proceed. The sentence, not a code:
  -- the point is that somebody reads it without a lookup table.
  reason      text,
  seeded      integer not null default 0,
  looked_at   integer not null default 0,
  observed    integer not null default 0,
  refused     integer not null default 0
);

create index if not exists survey_runs_ran_at_idx on public.survey_runs (ran_at desc);

comment on table public.survey_runs is
  'One row per observatory run: what it managed, and why it did not. Exists because a cron that reports into its own HTTP response reports to nobody.';

alter table public.survey_runs enable row level security;
