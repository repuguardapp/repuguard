-- 0019 — a source that cannot be fixed must stop shouting.
--
-- The first real run of the watcher found one working feed out of four.
-- CNIL delivered ten items, of which the extractor correctly kept two
-- enforcement decisions and rejected eight agendas, event notices and
-- awareness material. The pipeline works.
--
-- The other three did not, and they fail differently:
--
--   edpb           http_404 — the feed moved to /feed/news_en
--   eurlex_ai_act  200 with a 234-byte body and no items — the saved
--                  search behind that feed id no longer resolves
--   ico            http_404 — and there is no replacement to point at.
--                  The ICO withdrew every one of its RSS feeds pending
--                  a redesign and says only that it is "considering"
--                  bringing them back.
--
-- ICO is therefore disabled rather than left failing, and that is the
-- point of this migration. A source with no feed in existence would
-- have alerted every six hours, for ever. Four false alarms a day is
-- how an alerting channel stops being read — and we spent a day
-- building that channel precisely so it would be read. A monitor that
-- cries wolf is worse than no monitor, because it also discredits the
-- alerts that matter.
--
-- consecutive_failures makes that automatic from now on: the watcher
-- counts, and a source that has failed five runs in a row disables
-- itself and says so once. Re-enabling is a deliberate act, which is
-- correct — a dead feed comes back only when someone has found its
-- replacement.

alter table public.legal_sources
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists disabled_reason text;

comment on column public.legal_sources.consecutive_failures is
  'Reset to 0 on any successful poll. At the auto-disable threshold the watcher switches the source off and alerts once, rather than alerting every run for ever.';

-- The feed moved; the path gained a segment.
update public.legal_sources
   set feed_url = 'https://edpb.europa.eu/feed/news_en',
       last_status = null,
       last_error = null,
       consecutive_failures = 0
 where id = 'edpb';

-- No feed exists to point at. Off until one does.
update public.legal_sources
   set enabled = false,
       disabled_reason = 'ICO withdrew all RSS feeds pending a site redesign (ico.org.uk/global/rss-feeds). No replacement URL exists; re-enable when one is published.',
       consecutive_failures = 0
 where id = 'ico';

-- Answers 200 with a 234-byte body and no entries: the saved search
-- behind this feed id no longer resolves. Off until the feed is rebuilt
-- from EUR-Lex rather than guessed at a second time.
update public.legal_sources
   set enabled = false,
       disabled_reason = 'Saved-search feed returns an empty 234-byte body. Rebuild the feed from EUR-Lex and paste the new URL before re-enabling.',
       consecutive_failures = 0
 where id = 'eurlex_ai_act';
