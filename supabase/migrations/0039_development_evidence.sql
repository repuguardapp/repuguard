-- The sentence the regulator actually wrote, beside the field we took from it.
--
-- Approving an item in the review queue means LexyFlow asserts its facts in
-- seven languages. Checking them meant opening the regulator's page in
-- another tab and hunting for three values — entity, date, amount — in a
-- document that is often several thousand words in a language the reviewer
-- may not read. Thirty-seven items is an evening.
--
-- So extraction now returns, for each of those three fields, the span it
-- took the value from, and the span is VERIFIED against the fetched
-- document before it is stored: verifySpan finds it in the page and
-- returns the SOURCE's wording, not the model's. A quotation a model
-- produced and nobody checked is not evidence, it is a second assertion.
--
-- WHAT THIS IS NOT
--
-- Not the page. Three sentences, kept for internal verification and never
-- rendered on a public page — the same arrangement as scan_observations
-- .evidence. Facts are not copyrightable and a regulator's paragraphs are,
-- so we take a quotation to check a fact and publish neither.

alter table public.legal_developments
  add column if not exists evidence jsonb;

comment on column public.legal_developments.evidence is
  'Verified source spans backing the extracted fields, e.g. {"entity": "...", "decision_date": "...", "fine_eur": "..."}. Each one was found verbatim in the fetched page. Shown in the admin review queue only, never published.';
