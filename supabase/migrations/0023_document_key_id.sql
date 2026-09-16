-- Which key sealed this document.
--
-- Every ciphertext in this table was written under a single master key
-- with nothing recording which one. That is survivable until the day
-- someone has to rotate it — a suspected compromise, a leaked
-- environment dump, an employee leaving with a laptop — and on that day
-- the answer would have been that rotating makes every customer's
-- contract, DPA and policy permanently undecryptable. "We cannot
-- rotate" is not a sentence a compliance vendor can say out loud.
--
-- With the id stored beside the ciphertext, the process can hold
-- several keys at once: one active key that seals new documents, and
-- retired keys kept only to open old ones. Rotation becomes a deploy.
--
-- NULL means the row predates the keyring and was sealed by
-- DOCUMENT_ENCRYPTION_KEY, which the keyring loads as 'v1'. No
-- back-fill: the reader resolves null to 'v1', and lazy re-wrapping
-- fills the column in as documents are read. A back-fill would claim a
-- fact about ciphertext we have not opened.
--
-- The all-or-none constraint from 0009 deliberately does NOT grow to
-- cover this column. A retained document with a null key id is the
-- normal, correct state for everything written before today.

alter table public.audits
  add column if not exists document_key_id text;

-- Cheap and only useful during a rotation, which is exactly when
-- somebody will be running it every few minutes:
--   select count(*) from audits
--    where document_ciphertext is not null
--      and coalesce(document_key_id, 'v1') <> 'v2';
create index if not exists audits_document_key_id_idx
  on public.audits (document_key_id)
  where document_ciphertext is not null;

comment on column public.audits.document_key_id is
  'Id of the keyring entry that sealed document_ciphertext. NULL means v1, the pre-keyring DOCUMENT_ENCRYPTION_KEY.';
