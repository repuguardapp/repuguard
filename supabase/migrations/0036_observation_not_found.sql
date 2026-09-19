-- `absent` was a claim we cannot support. Renamed to `not_found`.
--
-- Migration 0035 allowed present / absent / unclear, and I wrote it
-- yesterday without noticing what the middle value asserts. "Absent" says
-- the thing is not in the document. What we actually know is that WE
-- LOOKED AND DID NOT FIND IT — and those are different statements about
-- somebody else's published text.
--
-- The gap is not hypothetical. A retention period written as "for as long
-- as your account remains open, and twelve months thereafter" states a
-- period without using the word. A DPO contact given only in an image, or
-- in a linked sub-page we did not fetch, is published and invisible to us.
-- A transfer described as "hosted in the United States" is a transfer
-- addressed without any of the vocabulary that names one — our own probe
-- found that case on the first realistic document we tried.
--
-- Rendering any of those as "absent" would put a false factual claim about
-- a named third party on a public page, which is the one thing this project
-- forbids without exception.
--
-- `not_found` renders as "not found in this document" and is true whatever
-- the document contains. The cost is a weaker-sounding word; the benefit is
-- that every sentence on the page survives being checked by the company it
-- names.
--
-- Safe to do bluntly: no scan has run yet, so the table is empty.

alter table public.scan_observations
  drop constraint if exists scan_observations_finding_check;

update public.scan_observations set finding = 'not_found' where finding = 'absent';

alter table public.scan_observations
  add constraint scan_observations_finding_check
  check (finding in ('present', 'not_found', 'unclear'));

comment on column public.scan_observations.finding is
  'present (with a verbatim span) / not_found (we looked and did not find it) / unclear. Never "absent": we cannot prove a negative about somebody else''s document.';
