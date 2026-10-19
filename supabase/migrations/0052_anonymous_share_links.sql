-- The share-link feature was documented in four files and implemented
-- in none of them.
--
-- WHY THIS CHANGES AN ACCESS RULE
--
-- `/embed/audit` lets anybody run a one-shot audit with no account. The
-- route is explicit about it: the anonymous-org UUID is the
-- public-share-link placeholder, the org-spoof guard is skipped for it
-- on purpose, and the paywall module, the report page, the edit page and
-- the audit API all branch on it as "public by UUID, never paywalled".
--
-- Nothing ever let anyone READ one.
--
-- Every SELECT policy on the three audit tables says the same thing:
--
--   organization_id::text = COALESCE(auth.jwt()->'app_metadata'
--                                    ->>'organization_id', '')
--
-- A visitor with no session has no JWT, the COALESCE falls to '', and
-- '' never equals '00000000-0000-0000-0000-000000000000'. So the embed
-- widget would have created the audit, redirected the visitor to the
-- report, and the database would have refused them the row — the same
-- "Page not found" a new customer hit tonight for a different reason.
--
-- It has never been seen because the anonymous org holds zero audits:
-- the feature has a producer, a consumer, four branches of handling, and
-- has never once run.
--
-- WHAT THIS GRANTS, PRECISELY
--
-- SELECT, to anyone, on rows belonging to the anonymous org and nothing
-- else. Policies are OR-ed, so the existing member rule is untouched and
-- no other organisation becomes more readable by a single row.
--
-- No INSERT, UPDATE or DELETE policy is added. Writing stays where it
-- is, with the service role.
--
-- WHY THAT IS ACCEPTABLE, AND WHERE IT WOULD NOT BE
--
-- These rows are submitted by people who were never asked to
-- authenticate and have no account to tie a report to. The only handle
-- on the report is its UUID — 122 bits of randomness, unguessable — and
-- that is exactly the Dropbox-share-link contract the code already
-- documents. `document_ciphertext` travels in the row but is AES-256-GCM
-- and its key is not in the database, so the row does not surrender the
-- uploaded document.
--
-- It would NOT be acceptable for any real organisation's audits, and
-- this grant cannot reach one: the id is a literal, not a parameter.
--
-- ONE THING THIS DOES NOT FIX, STATED RATHER THAN LEFT
--
-- A signed-in user may still submit with organizationId set to the
-- anonymous UUID. The spoof guard skips that branch by design, so their
-- report becomes publicly readable by UUID and escapes the paywall,
-- which treats anonymous-org audits as never paywalled. That predates
-- this migration and is not touched here.

create policy "anyone reads anonymous-org audits"
  on public.audits for select
  using (organization_id = '00000000-0000-0000-0000-000000000000'::uuid);

-- The findings and translations derive their rule from `audits` with the
-- member condition inlined, so widening `audits` alone would have
-- produced a report page with a header and no findings.
create policy "anyone reads anonymous-org findings"
  on public.audit_findings for select
  using (
    audit_id in (
      select id from public.audits
      where organization_id = '00000000-0000-0000-0000-000000000000'::uuid
    )
  );

create policy "anyone reads anonymous-org translations"
  on public.audit_translations for select
  using (
    audit_id in (
      select id from public.audits
      where organization_id = '00000000-0000-0000-0000-000000000000'::uuid
    )
  );
