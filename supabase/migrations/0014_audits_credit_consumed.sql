-- Record whether an audit actually spent a credit.
--
-- The refund decision lives in the audit request (`usingFreeTrial` —
-- a free-trial audit has no credit to give back), and nothing about it
-- survives on the row. Anything reconciling audits after the fact — the
-- reaper that fails audits stuck in `running`, and the async pipeline
-- that will create those rows — therefore cannot tell a refundable
-- audit from one that was free, and would either hand out credits
-- nobody paid for or silently keep ones that were.
--
-- Defaults to false so historical rows are never refunded by a sweep.
-- The audit route sets it truthfully from today.

alter table public.audits
  add column if not exists credit_consumed boolean not null default false;

comment on column public.audits.credit_consumed is
  'True when this audit spent a paid credit, so a later failure can refund exactly once.';
