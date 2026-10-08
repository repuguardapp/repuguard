-- What a deposit became, once a human finished what the API could not.
--
-- WHY THIS SCHEMA CHANGES, IN ONE SENTENCE
--
-- Each quarterly edition must be published as a new VERSION of the same
-- Zenodo record rather than as an unrelated dataset, and the only thing
-- that makes that possible is the concept DOI — which the table has
-- nowhere to put, so without this column every quarter mints an orphan
-- DOI and the citations we are trying to accumulate scatter across four
-- unrelated records a year instead of landing on one.
--
-- The other two columns exist because the row for the first edition is
-- now a sentence the table cannot express.
--
-- THE ROW SAYS TWO THINGS AT ONCE, AND BOTH ARE TRUE
--
-- Zenodo's edge answered 403 to our serverless range — "access to this
-- resource has been restricted due to unusual traffic from your network"
-- — and that refusal is the only record that the automated path is
-- blocked. Erasing it to write a DOI over the top would turn a known
-- outage into a clean row and we would rediscover the block next quarter.
--
-- So the row keeps the refusal AND carries the DOI, and `deposited_by`
-- says which of the two happened: 'api' when the robot did it, 'operator'
-- when a person did it by hand in the browser. Leaving that to be
-- inferred from the shape of the row — a doi and a refusal together can
-- only mean a human — is the kind of implicit encoding that let an `ok`
-- meaning "at least one element" keep a country green for months.
--
-- A RESERVED DOI IS NOT A PUBLISHED ONE
--
-- `doi` has always been filled from Zenodo's `prereserve_doi`, which
-- exists on a draft nobody has published. Printing it on the public page
-- would be telling a reader to cite a record that does not resolve. So
-- `published_at` is the gate: the page shows a DOI only once this column
-- says the record was actually minted, and a draft stays invisible.
--
-- It is a date and not a timestamp because Zenodo's own field is a date
-- — the record says "Published October 8, 2026" and nothing finer. A
-- timestamptz would have made us write midnight UTC, which is a time
-- nobody told us, into the row that exists to be checkable.

alter table public.observatory_deposits
  add column if not exists concept_doi text,
  add column if not exists deposited_by text,
  add column if not exists published_at date;

comment on column public.observatory_deposits.concept_doi is
  'The DOI of the series, identical for every edition and always resolving to the latest. What the next edition chains itself to, so citations accumulate on one record instead of scattering across one per quarter.';

comment on column public.observatory_deposits.deposited_by is
  'Who completed the deposit: api, or operator when a person did it by hand. Stated rather than inferred, because a row carrying both a refusal and a DOI is the normal shape while Zenodo blocks our address range.';

comment on column public.observatory_deposits.published_at is
  'The date Zenodo states the record was published. Null means the deposit is a draft with a reserved DOI that resolves to nothing, and the public page shows no citation at all.';
