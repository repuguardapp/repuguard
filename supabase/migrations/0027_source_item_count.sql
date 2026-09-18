-- "ok" was one item away from meaning nothing.
--
-- The ICO reported ok for as long as this pipeline has existed while its
-- entire corpus was a single row titled "Skip to main content" — its
-- accessibility link, whose href="#main-content" resolved against the
-- listing to the listing itself. "Skip to main content" is twenty
-- characters, so it passed the title check and became an item; one item is
-- all `items.length > 0` requires. A source harvesting a navigation link
-- was indistinguishable, in the only place anyone looks, from a source
-- that works. The United Kingdom was green on the operations page and
-- empty in the database.
--
-- The Garante is green today on one item: the Collegio's agenda. Real, and
-- not a decision. Green, and hollow.
--
-- A status without a magnitude cannot be read. Storing the count lets the
-- operations page say "ok, 8" and "ok, 1" — visibly different claims, only
-- one of which needs looking at.

alter table public.legal_sources
  add column if not exists last_item_count integer;

comment on column public.legal_sources.last_item_count is
  'Items parsed on the last successful poll. A source reporting ok on 1 item is usually harvesting furniture, not decisions.';
