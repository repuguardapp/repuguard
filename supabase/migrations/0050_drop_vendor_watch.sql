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

drop table if exists public.vendor_changes;
drop table if exists public.vendor_snapshots;
drop table if exists public.vendor_documents;
drop table if exists public.vendor_watches;
drop table if exists public.vendors;
