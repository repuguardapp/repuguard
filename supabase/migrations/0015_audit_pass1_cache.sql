-- Cache the expensive pass of the audit so a second language is cheap.
--
-- The Multi-Pass engine audits once in English (Claude, the costly
-- pass) and localises that pivot into the target language (GPT-4o,
-- roughly a tenth of the cost). Nothing kept the pivot, so auditing the
-- same document in a second language re-ran the whole analysis: we paid
-- twice for identical work, and the customer paid a second credit.
--
-- Keyed by organisation as well as document: two customers can upload
-- the same public document, and one must never read findings produced
-- from the other's upload.
--
-- Holds verbatim evidence quotes, exactly like audit_findings, so it
-- carries the same retention guarantee — /api/cron/purge deletes rows
-- past AUDIT_RETENTION_DAYS alongside the audits themselves.

create table if not exists public.audit_pass1_cache (
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  document_hash   text        not null,
  frameworks      text[]      not null,
  pivot           jsonb       not null,
  created_at      timestamptz not null default now(),
  primary key (organization_id, document_hash, frameworks)
);

-- Service-role only: the engine reads and writes it, nothing client-side
-- ever should. RLS on with no policy denies every other role outright.
alter table public.audit_pass1_cache enable row level security;

create index if not exists audit_pass1_cache_age_idx
  on public.audit_pass1_cache (created_at);

comment on table public.audit_pass1_cache is
  'English pivot of a completed pass 1, reused when the same document is audited into another language.';
