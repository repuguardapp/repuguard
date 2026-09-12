-- 0016 — the dedup index governs delivered reports, not attempts.
--
-- audits_dedup_idx enforces (organization_id, document_hash, language,
-- frameworks) uniqueness across EVERY row, whatever its status. That
-- was harmless while the audit row was only written at the very end of
-- the pipeline, once and already 'completed'.
--
-- The async pipeline writes the row up front, as 'running', so that a
-- customer who closes the tab still has an audit to come back to. With
-- the index as it stands, that row occupies the dedup slot for the
-- whole run and for ever after if it fails:
--
--   • a customer retrying the exact same document after a failure
--     collides with the corpse of their own failed attempt. That is
--     not hypothetical — it is the 11 Sep incident, where a finished
--     12-finding audit collided with an earlier failed row and the
--     customer was shown the failure;
--
--   • pass 2 can degrade to English after the row was opened with the
--     requested language, so the closing UPDATE moves the row to a
--     dedup key it never held, and can collide with a real English
--     report for the same document.
--
-- Restricting the index to completed rows says what we actually mean:
-- two DELIVERED reports for the same organization, document, language
-- and framework scope are the same report. Attempts are not reports.
-- Failed rows become plain history, and a retry is just a new attempt.
--
-- This only ever loosens the constraint, so it is safe to apply ahead
-- of the code that needs it: the current pipeline inserts 'completed'
-- rows exclusively, and for those rows the index is unchanged.

drop index if exists audits_dedup_idx;

create unique index audits_dedup_idx
  on public.audits (organization_id, document_hash, language, frameworks)
  where status = 'completed';

comment on index audits_dedup_idx is
  'Two delivered reports for the same org, document, language and framework scope are the same report. Deliberately excludes pending/running/failed rows: an attempt is not a report, and a failed attempt must never block its own retry.';
