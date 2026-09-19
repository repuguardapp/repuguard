-- A third kind of source: the sitemap.
--
-- Half the authorities we need are single-page applications. The ICO's
-- enforcement listing carries 39 links and not one decision; SDAIA's news
-- page carries six, two of which are the cookie banner's "yes" and "no";
-- Qatar's NCSA answers with 5KB containing no links at all. No item_pattern
-- can read those, because the decisions are genuinely absent from the
-- document a crawler receives. That looked like a limit of method.
--
-- It is not. A site that renders its list in the browser still has to be
-- found by search engines, so it publishes the same list as XML —
-- server-side, complete, and advertised in its own robots.txt. The sitemap
-- is the listing page without the JavaScript, and it is the politest thing
-- on the domain: a file whose entire purpose is to be read by machines so
-- that they need not crawl.
--
-- item_pattern is required here for the same reason as for a listing: a
-- sitemap without one is every page on the site, including the privacy
-- notice and the staff directory.

alter table public.legal_sources
  drop constraint if exists legal_sources_feed_kind_check;

alter table public.legal_sources
  add constraint legal_sources_feed_kind_check
  check (feed_kind in ('rss', 'atom', 'html', 'sitemap'));

alter table public.legal_sources
  drop constraint if exists legal_sources_html_needs_pattern;

alter table public.legal_sources
  add constraint legal_sources_html_needs_pattern
  check (feed_kind not in ('html', 'sitemap') or item_pattern is not null);

comment on column public.legal_sources.feed_kind is
  'rss/atom: an XML feed. html: a listing page, links matching item_pattern. sitemap: the site''s own XML index, for listings built in the browser.';
