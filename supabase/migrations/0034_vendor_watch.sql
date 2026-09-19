-- Sub-processor watch: the only thing we can build that a DPO cannot do
-- by hand, made entirely of facts somebody else published.
--
-- THE PROBLEM, STATED PRECISELY
--
-- Article 28(2) gives a controller the right to object when a processor
-- changes its sub-processors, and Article 44 makes a new sub-processor in a
-- third country a transfer the controller has to reassess. Every vendor
-- publishes its sub-processor list on a public page and tells customers to
-- "subscribe for changes". A company using fifty SaaS vendors would need
-- fifty subscriptions, and someone to read fifty notifications and work out
-- which ones matter. Nobody does this. It is the most clearly mandated,
-- most universally skipped task in the job.
--
-- Thousands of DPOs are also each reading the SAME public pages: AWS's list
-- is the same list for everyone who uses AWS. That duplicated reading is
-- what a machine should absorb.
--
-- WHY THIS IS SAFE TO PUBLISH, WHICH IS THE WHOLE POINT
--
-- "On 12 March, Vendor X's published sub-processor page added Y, located in
-- Z" is a fact about a public document, with a URL and a date, reproducible
-- from two stored hashes. It is not a judgement about Vendor X, and we never
-- make one: "X is non-compliant" is an accusation, and a false one is
-- defamatory. The same discipline as the enforcement corpus.
--
-- A CHANGE IS A DIFF BETWEEN TWO FETCHES. IT IS NEVER INFERRED.
--
-- No model decides that something changed. Two snapshots with different
-- content hashes exist, or there is no change to report.

create table if not exists public.vendors (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  homepage    text,
  created_at  timestamptz not null default now()
);

create table if not exists public.vendor_documents (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.vendors (id) on delete cascade,
  kind          text not null check (kind in ('subprocessors', 'dpa', 'privacy', 'security')),
  url           text not null,
  -- Same discipline as legal_sources: a document added from a sandbox that
  -- cannot open it is a candidate, silent and long-roped, until a fetch has
  -- actually produced something.
  verified_at   timestamptz,
  last_fetched_at timestamptz,
  last_status   text,
  last_error    text,
  consecutive_failures integer not null default 0,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (vendor_id, kind, url)
);

-- One row per fetch that produced a different document.
--
-- The hash is what makes every published claim reproducible: two snapshots,
-- two hashes, and the difference between their extracted lists is the
-- change. Nothing here is generated.
create table if not exists public.vendor_snapshots (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.vendor_documents (id) on delete cascade,
  content_hash  text not null,
  fetched_at    timestamptz not null default now(),
  -- [{ name, purpose, country }] exactly as printed in the source.
  entries       jsonb not null default '[]'::jsonb,
  entry_count   integer not null default 0,
  -- Extraction that looked wrong is quarantined rather than published: see
  -- the note on vendor_changes.review_required.
  suspect       boolean not null default false,
  suspect_reason text,
  unique (document_id, content_hash)
);

create index if not exists vendor_snapshots_doc_idx
  on public.vendor_snapshots (document_id, fetched_at desc);

-- Append-only. One row per entity added or removed between two snapshots.
create table if not exists public.vendor_changes (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.vendor_documents (id) on delete cascade,
  from_snapshot uuid references public.vendor_snapshots (id) on delete set null,
  to_snapshot   uuid not null references public.vendor_snapshots (id) on delete cascade,
  change        text not null check (change in ('added', 'removed')),
  -- As printed in the source, never normalised for display. Normalisation
  -- exists only to compare; what we show is what they wrote.
  entity_name   text not null,
  entity_country text,
  entity_purpose text,
  -- A change nobody has confirmed is not shown to a customer.
  --
  -- The failure that would end this product: a vendor redesigns its page,
  -- extraction returns nothing, and we tell five hundred DPOs that their
  -- processor removed all forty of its sub-processors. Every one of them
  -- would act on it. A large or total disappearance is therefore held for
  -- review instead of published, and the poller treats an empty extraction
  -- as a failure rather than as an emptied list.
  review_required boolean not null default false,
  detected_at   timestamptz not null default now()
);

create index if not exists vendor_changes_doc_idx
  on public.vendor_changes (document_id, detected_at desc);

-- Who asked to be told.
create table if not exists public.vendor_watches (
  organization_id uuid not null,
  vendor_id       uuid not null references public.vendors (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (organization_id, vendor_id)
);

alter table public.vendors enable row level security;
alter table public.vendor_documents enable row level security;
alter table public.vendor_snapshots enable row level security;
alter table public.vendor_changes enable row level security;
alter table public.vendor_watches enable row level security;

comment on table public.vendor_snapshots is
  'One row per fetch producing a different hash. The hash makes every published change reproducible; nothing here is generated by a model.';
comment on column public.vendor_changes.review_required is
  'A change too large to trust. A page redesign that breaks extraction must never be published as "your processor removed everything".';
