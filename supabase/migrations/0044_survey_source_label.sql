-- How the ranking describes itself, in the words the page will print.
--
-- The source stopped being a constant the day its URL answered 404 eight
-- times. The seeding now tries several candidates and records which one
-- answered — and these rankings do not measure the same thing. Tranco
-- aggregates traffic rankings; Majestic ranks by referring subnets. A
-- study whose population came from the second must not say "most
-- visited", so the basis travels with the sample rather than living in a
-- sentence somebody has to remember to change.

alter table public.survey_domains
  add column if not exists source_label text;

comment on column public.survey_domains.source_label is
  'How the ranking is described in the methodology, basis included. Stored rather than hardcoded on the page, because which ranking answered is decided at seeding time.';
