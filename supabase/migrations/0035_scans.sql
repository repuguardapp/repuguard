-- Public scans: the front door, and the rule that shapes it.
--
-- A scanner that audits a named third party's site publishes a judgement
-- about them, and a false one is defamatory. But "this document states no
-- retention period" is an observable property of a text the organisation
-- published to the world, checkable by anyone who opens it. That line is
-- where this table lives.
--
-- PRIVATE BY DEFAULT. VERIFICATION GATES INDEXING, NOT ACCESS.
--
-- Every scan is reachable at an unguessable token immediately, so the
-- person who ran it can send the link to their team — the useful virality,
-- available from the first second. It becomes a canonical, indexable page
-- at /scan/<domain> only once someone has proved they control the domain
-- with a DNS TXT record. Their document, their domain, their choice.
--
-- The sub-processor corpus carries the indexable half of the loop, and
-- carries it legitimately: those vendors publish their lists precisely to
-- be read and compared.

create table if not exists public.scans (
  id            uuid primary key default gen_random_uuid(),
  -- Unguessable, and the only way to reach the result until a domain is
  -- verified. Not derived from the domain: a token you can compute from a
  -- company name is not a private link.
  token         text not null unique,
  domain        text not null,
  locale        text not null default 'en',
  status        text not null default 'queued'
                check (status in ('queued', 'running', 'done', 'failed')),
  -- Why it failed, in the words we would show. "Nothing found" is a fact
  -- about our search, never about the site.
  failure       text,
  -- Set when a DNS TXT record proved control of the domain. Until then the
  -- result page carries noindex.
  domain_verified_at timestamptz,
  requested_by  text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index if not exists scans_domain_idx on public.scans (domain, created_at desc);

-- The document as received, identified by the hash of its raw bytes.
--
-- The hash is over the bytes, not over the extracted text, so it keeps
-- identifying the same document even if our extraction changes. That is
-- what makes every downstream statement reproducible: anyone can fetch the
-- URL, hash it, and land on the same snapshot.
create table if not exists public.scan_snapshots (
  id            uuid primary key default gen_random_uuid(),
  scan_id       uuid not null references public.scans (id) on delete cascade,
  url           text not null,
  -- 'linked-from-homepage' is the site's own answer to "where is your
  -- privacy policy". 'conventional-path' is our guess. A reader is entitled
  -- to know which one they are looking at.
  provenance    text not null
                check (provenance in ('linked-from-homepage', 'listed-in-sitemap', 'conventional-path')),
  content_hash  text not null,
  content_type  text,
  byte_length   integer not null,
  text_length   integer not null,
  fetched_at    timestamptz not null default now()
);

create index if not exists scan_snapshots_scan_idx on public.scan_snapshots (scan_id);

-- Facts about the document. Never a verdict about the organisation.
create table if not exists public.scan_observations (
  id            uuid primary key default gen_random_uuid(),
  snapshot_id   uuid not null references public.scan_snapshots (id) on delete cascade,
  -- e.g. 'retention_period_stated', 'dpo_contact_published'.
  observation   text not null,
  -- present / absent / unclear. `unclear` is first-class: a reader is
  -- better served by "we could not tell" than by a confident wrong answer,
  -- and forcing every question into yes/no is how a page fills with them.
  finding       text not null check (finding in ('present', 'absent', 'unclear')),
  -- The span of the document this rests on. An observation with no evidence
  -- is an opinion, and opinions do not go on this site.
  evidence      text,
  created_at    timestamptz not null default now()
);

create index if not exists scan_observations_snapshot_idx
  on public.scan_observations (snapshot_id);

alter table public.scans enable row level security;
alter table public.scan_snapshots enable row level security;
alter table public.scan_observations enable row level security;

comment on table public.scan_snapshots is
  'The document as received. content_hash is over the raw bytes so it survives changes to our extraction, which is what makes every published observation reproducible.';
comment on column public.scan_observations.finding is
  'present / absent / unclear. Facts about the document, never a qualification of the organisation.';
