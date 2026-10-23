-- What yesterday's report said, so today's can say what changed.
--
-- WHY THIS IS NEEDED AT ALL
--
-- The digest opens with "NEEDS YOU" and then prints fifteen lines that
-- have been byte-identical since 20 October: nine switched-off sources
-- and three barren ones. They are real and they do need a decision, but
-- they are not news, and a report that leads with the same backlog
-- every morning teaches its reader to skip the top.
--
-- The file that composes it already says so, twice, about other things:
--
--   "a numbered action every morning is how an action list stops being
--    read"
--   "four alerts a day for a regulator that withdrew its RSS is how an
--    alerting channel stops being read"
--
-- and then the source lists were allowed to do precisely that.
--
-- THE MORNING THAT PROVED IT
--
-- On 23 October the CNIL came back: last_status ok, 10 items,
-- consecutive_failures reset, the first clean poll since its
-- maintenance window — and the proof that the transient-failure rule
-- shipped the day before had kept it alive to recover. That was the
-- single new fact of the day and it appeared in the digest as the
-- ABSENCE of a line the reader would have had to remember from
-- yesterday. The instrument shouted the backlog and whispered the
-- change.
--
-- WHAT IS STORED
--
-- Only the comparable shape of a report: which sources were in which
-- bucket, and the corpus counts. Not the rendered text — the wording
-- changes when the code changes, and a diff against prose would report
-- an edit to a sentence as an operational event.
--
-- One row per day. The digest runs once at 06:00 UTC; a second run on
-- the same day overwrites rather than accumulating, so a manual re-run
-- while debugging cannot make the next morning believe everything
-- changed twice.

create table if not exists public.digest_snapshots (
  taken_on   date        primary key default current_date,
  payload    jsonb       not null,
  created_at timestamptz not null default now()
);

comment on table public.digest_snapshots is
  'The comparable shape of each daily digest, so the next one can report what changed rather than repeating the standing backlog. See migration 0054.';

-- Nothing but the service role reads or writes this. It is operational
-- memory, not content.
alter table public.digest_snapshots enable row level security;
