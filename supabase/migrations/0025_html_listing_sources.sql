-- A watcher that only speaks RSS can only ever cover Europe.
--
-- We sell audits against thirteen frameworks — seven Gulf regimes,
-- Brazil's LGPD, Japan's APPI — and the decisions corpus, the one thing
-- on this site that nobody else publishes, could only ever be
-- European. Not by choice: the ICO withdrew every one of its feeds, the
-- Gulf authorities never had any, and Brazil's ANPD and Japan's PPC
-- publish news pages. RSS is the exception, not the rule.
--
-- So a source may now be a listing page: fetch it, take the links whose
-- path contains `item_pattern`, hand them to the same pipeline. The
-- item is thinner — a URL and the anchor text — and that is enough,
-- because pass 2 reads the decision page itself for every fact that
-- matters, including the date.
--
-- `item_pattern` is a plain substring and not a regex, deliberately.
-- The value is written by an operator into a database row and used
-- against a page we do not control; a regex there is a way to hang the
-- poller on someone else's HTML.

alter table public.legal_sources
  add column if not exists item_pattern text;

alter table public.legal_sources
  drop constraint if exists legal_sources_feed_kind_check;

alter table public.legal_sources
  add constraint legal_sources_feed_kind_check
  check (feed_kind in ('rss', 'atom', 'html'));

-- A listing source without a pattern would take every same-origin link
-- on the page, including the privacy notice and the cookie banner.
alter table public.legal_sources
  drop constraint if exists legal_sources_html_needs_pattern;

alter table public.legal_sources
  add constraint legal_sources_html_needs_pattern
  check (feed_kind <> 'html' or item_pattern is not null);

comment on column public.legal_sources.item_pattern is
  'For feed_kind=html: a substring every decision URL path contains, e.g. "/sanction-". Same-origin links matching it become items.';
