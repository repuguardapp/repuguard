-- The amount carries its currency, or it is not a fact.
--
-- The column was called `fine_eur` and the tool schema told the model
-- "omit entirely if the currency is not euros". Of the nine ICO fines in
-- the review queue, the model ignored that on nine. Our own stored
-- summaries are the evidence:
--
--   South Staffordshire Water   summary "£963,900"   fine_eur 963900.00
--   KRA Consultancy             summary "£300,000"   fine_eur 300000.00
--   Quick Tax Claims            summary "£120,000"   fine_eur 120000.00
--   ...
--   Police Service of Scotland  summary  "£66,000"   fine_eur  73920.00
--
-- The first eight are pound amounts sitting in a column named for euros:
-- a page reading "sanctionnée de 963 900 euros" about a named company,
-- which is false and is about a third party. The last one is worse — the
-- model CONVERTED, at a rate it did not state, on a date it did not
-- state, and produced a figure that appears in no document anywhere.
-- That is a fabricated number attached to a named police force.
--
-- None of it reached the public pages: the five published decisions are
-- all eurozone authorities and all human-reviewed. It was waiting in the
-- queue for an operator to approve thirty-seven rows in one sitting,
-- which is exactly the kind of approval this arrangement is supposed to
-- make safe.
--
-- So the amount and its currency travel together, as ISO 4217, as the
-- source states it, and nothing in this codebase converts. A currency we
-- cannot read means no amount at all — the same rule as every other
-- field here.

alter table public.legal_developments
  add column if not exists fine_amount numeric,
  add column if not exists fine_currency text;

-- Three letters, uppercase. A free-text currency is how "£" ends up
-- stored as "EUR" by a different route.
alter table public.legal_developments
  drop constraint if exists legal_developments_fine_currency_check;
alter table public.legal_developments
  add constraint legal_developments_fine_currency_check
  check (fine_currency is null or fine_currency ~ '^[A-Z]{3}$');

-- An amount with no currency is not publishable, and a currency with no
-- amount says nothing. They are present together or not at all.
alter table public.legal_developments
  drop constraint if exists legal_developments_fine_pair_check;
alter table public.legal_developments
  add constraint legal_developments_fine_pair_check
  check ((fine_amount is null) = (fine_currency is null));

-- Backfilled for the published and approved rows ONLY.
--
-- Those five were read by a human before publication, and all three that
-- carry an amount come from the CNIL and the Irish DPC — eurozone
-- authorities whose own pages state euros, which our summaries quote as
-- "500,000 euros", "300,000 euros" and "645,000". Their euro label is
-- checked, so it is kept.
--
-- The thirty-seven rows awaiting review are NOT backfilled. Their
-- currency is unverified by construction and wrong in nine known cases,
-- and copying it forward under a new name would launder exactly the
-- error this migration exists to remove. They are requeued instead, and
-- re-extracted against a schema that asks the question properly.
update public.legal_developments
   set fine_amount = fine_eur,
       fine_currency = 'EUR'
 where fine_eur is not null
   and status in ('published', 'approved');

comment on column public.legal_developments.fine_amount is
  'The amount as the source states it. Never converted. Null unless fine_currency is also known.';

comment on column public.legal_developments.fine_currency is
  'ISO 4217 code of the currency the SOURCE uses — GBP for an ICO penalty, EUR for the CNIL. Never our conversion of it.';

-- `fine_eur` stays for now, read by nothing, so a wrong value cannot be
-- rendered while it is still the only record of what the model answered.
-- It is dropped in a later migration once the requeued rows have been
-- re-extracted and the column is provably empty of anything we need.
comment on column public.legal_developments.fine_eur is
  'DEPRECATED and read by no code. Held nine pound amounts and one invented conversion. Superseded by fine_amount + fine_currency; dropped once the requeue is confirmed.';
