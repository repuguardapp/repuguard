-- A source that has never worked is not a source that broke.
--
-- The auto-disable rule exists to stop a feed that no longer exists from
-- alerting four times a day for ever — a real risk, and how an alerting
-- channel stops being read. But it treats two opposite situations the same
-- way, and the Gulf makes that expensive.
--
-- We sell audits against six Gulf regimes and watch none of them. Adding
-- those authorities means adding URLs nobody here can open: the build
-- sandbox reaches no regulator domain, so the first honest description of
-- each new source is "candidate", not "working". Under the existing rule a
-- candidate would alert on every run and switch itself off after five —
-- about thirty hours, which is less time than it takes to read what the
-- prober found and try the next path. Every Gulf source would be dead
-- before anyone had learned anything from it, and the alerting channel
-- would have been trained to be ignored by the six sources it was
-- reporting on.
--
-- So a source carries the moment it first produced items. Until then it is
-- on probation: it never alerts, and it gets a longer rope. After that it
-- is a normal source and the five-failure rule applies, because from then
-- on a failure means something changed.

alter table public.legal_sources
  add column if not exists verified_at timestamptz;

-- Backfill: a source that has ever produced an item has proved itself.
-- Everything else — including Brazil, whose listing is built in the
-- browser, and the EDPS, which refuses us outright — is a candidate, which
-- is what those two have always actually been.
update public.legal_sources
set verified_at = coalesce(last_polled_at, now())
where verified_at is null
  and id in (select distinct source_id from public.legal_developments);

comment on column public.legal_sources.verified_at is
  'First poll that produced items. Null means the source has never worked: on probation, never alerts, longer rope before auto-disable.';
