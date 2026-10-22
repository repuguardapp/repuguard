-- A daily ceiling on free anonymous audits that actually holds.
--
-- WHY A TABLE AND NOT THE LIMITER WE ALREADY HAVE
--
-- src/lib/rate-limit.ts says so itself:
--
--   "Rate limiter — fixed-window counter, in-memory, process-local …
--    For multi-instance correctness, swap the store for Upstash Redis"
--
-- On Vercel each warm function instance holds its own Map, so the
-- ceiling is multiplied by however many instances are warm. That was
-- tolerable while /embed/audit was undocumented and nobody could reach
-- it. It stops being tolerable the moment we publish a page saying
-- "copy this snippet onto your site", which is the next commit.
--
-- THE SECOND DEFECT, WHICH IS WORSE
--
-- ORG_LIMIT is 50/day PER ORGANISATION, and every audit the widget
-- creates belongs to the same anonymous organisation. So the cap is
-- shared by every embedder on earth: one popular site — or one bored
-- visitor — closes the door for all the others. A free tool that any
-- single user can switch off for everyone is not a distribution
-- channel.
--
-- WHAT IT COSTS, MEASURED RATHER THAN GUESSED
--
-- model_usage, all audits to date: 11,621 input and 7,878 output tokens
-- per audit on claude-sonnet-4-6, at $3 and $15 per million. That is
-- about $0.15 each, and it counts pass 1 only — localisation is extra.
--
-- The default ceiling of 25/day is therefore roughly $4 a day of
-- exposure in the worst case. It is a budget decision, not a technical
-- one, so it reads from ANONYMOUS_DAILY_AUDITS and this number is only
-- the default for an account with no revenue yet.
--
-- WHY A COUNTER ROW AND NOT A COUNT(*) OVER audits
--
-- Counting the audits table would be the obvious thing and it would be
-- wrong twice: it races under concurrency, and it would quietly stop
-- counting the day somebody adds a retention purge. A single row per
-- day, incremented by the insert itself, is serialised by its own row
-- lock and means exactly what it says.

create table if not exists public.anonymous_audit_quota (
  day   date    primary key default current_date,
  used  integer not null    default 0,
  -- Not for the cap — for reading afterwards whether a day hit the
  -- ceiling because of real demand or because of one address.
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

comment on table public.anonymous_audit_quota is
  'One row per day. Counts audits created by the anonymous org (the /embed/audit widget), so the free-tier ceiling survives across Vercel instances. See migration 0053.';

-- No RLS policy is added, which is deliberate: nothing but the service
-- role touches this table. A visitor has no business reading how much
-- of today''s free allowance is left, and no business writing to it.
alter table public.anonymous_audit_quota enable row level security;
