-- Remove the subprocessor-watch feature. Five tables, zero rows, zero
-- code paths.
--
-- WHY, IN ONE SENTENCE
--
-- It was built, deployed and never wired to anything: nothing in `src/`
-- reads or writes these tables, the one library file that served them is
-- imported solely by its own test, and in the months they have existed
-- they have held no data at all — so every future migration, every type
-- generation, every RLS audit and every schema review has been paying
-- maintenance on a feature the market has not asked for while the core
-- product is still unvalidated.
--
-- THE CORE PRODUCT IS UNVALIDATED, AND THAT IS THE ACTUAL ARGUMENT
--
-- `audits` holds zero rows. The paid product has never run once. Stripe
-- livemode holds two customers, both the operator's own companies, and
-- one charge of €45 that was refunded in full. Carrying a secondary
-- feature in that state is not caution, it is cost — and the decision to
-- cut it was the operator's, taken on those figures.
--
-- WHAT IS NOT LOST
--
-- The thinking. `subprocessor-diff.ts` and its tests are deleted in the
-- same commit as this migration, so the comparison logic, the entry
-- normalisation and the suspect-extraction heuristics stay recoverable
-- from git history by anyone who rebuilds this. Nothing here is a
-- decision that a future version cannot reverse; it is a decision not to
-- keep paying for it today.
--
-- WHAT THIS DELETES, AND WHAT IT CANNOT
--
-- Nothing but empty tables. Every one was verified empty immediately
-- before this ran, and every foreign key among them points at another
-- table in this same group — nothing outside the cluster references it,
-- so no cascade reaches anything we are keeping. The drops are ordered
-- so each table goes after its dependants, which means this migration
-- never needs `cascade` and therefore cannot quietly take something it
-- was not pointed at.

-- NOT APPLIED TO PRODUCTION AS OF 2026-10-18, AND NOT FOR THE REASON I
-- FIRST GAVE.
--
-- Two commit messages before this one say Supabase's write path had
-- stopped responding. That was wrong and the evidence contradicts it:
-- SELECT returns instantly, UPDATE committed a row on this same table
-- set, `comment on table` applied in under a second, and `create table`
-- succeeded. Only DROP TABLE hangs — including on a brand new empty
-- table created seconds earlier, and including with no lock whatsoever
-- held on the target, which pg_locks confirmed.
--
-- So it is not an outage, not a lock, and not these tables. Destructive
-- statements are gated behind a confirmation the agent tooling cannot
-- surface in this session, and the gate times out instead of saying so.
--
-- The obvious way around it is to hide the DROP inside EXECUTE in a DO
-- block, where a statement-level guard cannot read it. This repository
-- does not do that. The rule it applies to other people's bot
-- mitigation — we identify ourselves and publish the refusal rather
-- than defeat it — applies with more force to a guard protecting our
-- own production database from exactly this class of act. A guard that
-- can be stepped over by whoever is in a hurry is not a guard.
--
-- Cost of leaving it: five empty tables nothing references. The file
-- stays here so the drop happens the day the tooling allows it or
-- `supabase db push` runs, and `if exists` makes that safe whenever it
-- is.
--
-- MY OWN LITTER, LEFT BEHIND
--
-- public._probe_drop_gate — one empty table, no columns of consequence,
-- created by me to test whether the gate was specific to the vendor
-- tables. It was not. I could not then remove it, for the same reason
-- this migration has not run. It is dropped below with the others.

drop table if exists public._probe_drop_gate;

drop table if exists public.vendor_changes;
drop table if exists public.vendor_snapshots;
drop table if exists public.vendor_documents;
drop table if exists public.vendor_watches;
drop table if exists public.vendors;
