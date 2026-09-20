-- Proof of control over a domain, which is the only thing that makes a
-- scan page indexable.
--
-- Anyone may run a scan of any domain and share the link: a link is not a
-- search result, and it costs the scanned company nothing. What nobody may
-- do is put another company's name into Google under our analysis. That
-- takes a DNS TXT record, which only somebody who administers the domain
-- can create.
--
-- VERIFICATION BELONGS TO THE DOMAIN, NOT TO A SCAN.
--
-- 0035 put `domain_verified_at` on `scans`, which was wrong: proving you
-- control example.com is a fact about example.com, and it would have had to
-- be copied onto every future scan row or silently not apply to them. One
-- row per domain, and every scan of it reads the same answer.
--
-- The column is dropped rather than left in place. No scan has ever been
-- verified, so nothing is lost, and a field that can no longer be filled
-- honestly does not stay in the schema to mislead the next reader.

create table if not exists public.domain_verifications (
  domain      text primary key,
  verified_at timestamptz not null default now(),
  -- The record we actually found, so a later dispute can be settled by
  -- looking rather than by remembering.
  txt_record  text not null,
  -- Where we looked. Stored because the convention may change and old
  -- verifications must stay explicable.
  txt_name    text not null
);

alter table public.scans drop column if exists domain_verified_at;

alter table public.domain_verifications enable row level security;

comment on table public.domain_verifications is
  'One row per domain proved by DNS TXT. Verification makes /scan/<domain> indexable; it is a fact about the domain, never about a single scan.';
