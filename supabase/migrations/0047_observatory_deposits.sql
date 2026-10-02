-- One Zenodo draft per edition, and a record that it exists.
--
-- Creating the draft was the last manual act left in the distribution
-- chain: the crawl fills itself, the page builds itself, the dataset
-- serves itself, and then somebody had to remember to press a button on
-- an admin page on the day the sample happened to finish. A step that
-- depends on a human noticing a moment is a step that does not happen.
--
-- So the cron that finishes the edition now creates the draft. What it
-- must never do is create a second one: Zenodo would accept it, and we
-- would have two drafts of the same edition with two reserved DOIs, one
-- of which gets published and one of which sits there looking equally
-- real. This table is the lock, and `edition` carries the unique
-- constraint that enforces it.
--
-- THE DRAFT IS AUTOMATIC. THE DOI IS NOT.
--
-- Nothing here publishes. A draft can be deleted; a minted DOI is
-- permanent by design and cannot be withdrawn, only superseded. This
-- codebase has spent weeks finding the mornings where the pipeline
-- produced something confidently wrong — seven blank observations about
-- Airbnb, a sitemap of 321 undated children read as an empty regulator, a
-- ministry newsroom ingested as a data-protection feed. The last click
-- stays with the person who has looked at the numbers, and it is one
-- click per quarterly edition, which is not the kind of manual work the
-- zero-manual rule exists to remove.

create table if not exists public.observatory_deposits (
  id uuid primary key default gen_random_uuid(),
  -- The ranking id the sample was drawn from. One edition, one deposit.
  edition text not null unique,
  deposition_id bigint,
  doi text,
  edit_url text,
  -- How many domains the edition had looked at when it was deposited.
  -- Stored so a record can be checked against the figures it claims
  -- without trusting that the edition never moved afterwards.
  looked_at integer not null default 0,
  sample_size integer not null default 0,
  documents_read integer not null default 0,
  -- Set when the attempt failed, so a refusal is a row rather than a log
  -- line. A deposit that silently did not happen is indistinguishable
  -- from one nobody looked at.
  refused text,
  created_at timestamptz not null default now()
);

comment on table public.observatory_deposits is
  'One row per observatory edition deposited to Zenodo. The unique constraint on edition is what stops a cron creating a second draft with a second reserved DOI.';

comment on column public.observatory_deposits.refused is
  'Why the deposit did not happen. A failed attempt is recorded rather than retried silently, so the row is also the record that we tried.';

-- Written only by the service role: the cron and the admin route. No
-- policy is granted, so RLS denies everything else by default.
alter table public.observatory_deposits enable row level security;
