-- Who was sanctioned.
--
-- The corpus published its first two decisions with these headlines:
--
--   CNIL — €300,000 fine — GDPR Art. 12, GDPR Art. 17 — 2026-07-21
--   CNIL — €500,000 fine — GDPR Art. 32, GDPR Art. 34 — 2026-07-21
--
-- Same authority, same date, and nothing to tell them apart. The one
-- word a reader needs — EXTIA, Hôpital Privé de la Loire — was in the
-- summary and nowhere else, so the index read as a database dump and
-- the pages ranked for nothing: nobody searches "CNIL 300000 Art 12".
-- They search "amende EXTIA CNIL".
--
-- Nullable on purpose. Guidance and opinions have no respondent, and a
-- header invented for them would be worse than a missing one. An
-- enforcement decision without an entity simply keeps the old title
-- shape.
--
-- This is also the field with the highest defamation stake in the
-- table: it names an identifiable organisation in an H1, in seven
-- languages. It is written by extraction and gated by the same human
-- approval as everything else, and the reviewer already sees it — it
-- is the subject of the first sentence of the summary they approve.

alter table public.legal_developments
  add column if not exists entity text;

comment on column public.legal_developments.entity is
  'Organisation the decision was taken against, as named by the source. Null for guidance, opinions and anything with no respondent.';
