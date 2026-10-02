-- An item that cannot be extracted must stop costing money.
--
-- Two developments failed extraction on every run since 27 September with
-- the same message: the model sent `evidence.fine_eur: null` where the
-- schema expected the key to be absent, the parse threw, and the row
-- stayed `discovered`. Four runs a day, two model calls each, for ever —
-- and the alert that fired every time named a different development id,
-- so the repetition read as five separate incidents rather than one bug.
--
-- A retry that is never bounded is not a retry, it is a standing order to
-- spend. These two columns bound it: a failure that is about the item
-- counts against it, and the third one moves the row to `extract_failed`
-- carrying the last error, where the digest can name it and a human can
-- read what actually went wrong without opening Vercel.
--
-- Only item-level failures count. An exhausted balance or a rejected key
-- abandons the whole run and touches no counter, because parking real
-- decisions over a billing lapse is the expensive mistake in the other
-- direction. A run killed by its own timeout also counts nothing, which
-- is the one gap: it is accepted rather than papered over, because
-- counting an attempt before making it would let a single outage park
-- every item in the queue.
--
-- `extract_failed` is a terminal state in the pipeline, not a verdict on
-- the regulator's page: it says our extractor could not read it. Resetting
-- the counter to zero puts the row back in the queue, which is the correct
-- thing to do after fixing the extractor.

alter table public.legal_developments
  add column if not exists extract_attempts integer not null default 0,
  add column if not exists extract_error text;

comment on column public.legal_developments.extract_attempts is
  'How many times extraction has failed for a reason specific to this item. Account-level failures are not counted. Set back to 0 to requeue an item after fixing the extractor.';

comment on column public.legal_developments.extract_error is
  'The last extraction failure, in full. Recorded when the item is parked as extract_failed, so the reason lives in the database rather than only in a log line nobody reads.';

-- The queue reads `discovered` ordered by published_at and now also filters
-- on the attempt count, so this is the index that query wants.
create index if not exists legal_developments_extract_queue_idx
  on public.legal_developments (status, extract_attempts, published_at desc);
