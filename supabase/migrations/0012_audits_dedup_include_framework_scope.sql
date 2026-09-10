-- The framework scope belongs in an audit's identity.
--
-- audits_dedup_idx was (organization_id, document_hash, language). Two
-- audits of the same document, in the same language, against entirely
-- different regulations therefore collided on insert — and the API's
-- 23505 branch treated that as an idempotent replay and handed back
-- the earlier row. Observed in production on 10 Sep 2026: a request for
-- EU AI Act + Qatar PDPPL returned a GDPR audit generated hours
-- earlier, correctly labelled GDPR, presented as the answer.
--
-- The route now writes `frameworks` sorted and de-duplicated, so the
-- array is canonical and set-equal scopes hash to the same key
-- regardless of the order they were selected in.

drop index if exists audits_dedup_idx;

create unique index if not exists audits_dedup_idx
  on public.audits (organization_id, document_hash, language, frameworks);
