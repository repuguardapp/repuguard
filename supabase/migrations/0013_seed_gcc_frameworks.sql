-- Seed the six GCC frameworks that the application has been offering
-- for months without them existing in the database.
--
-- 0002_seed_frameworks.sql inserted 7 of the 13 frameworks in
-- src/lib/legal-frameworks.ts. The six Gulf regimes were missing, and
-- audit_findings.framework_id is a foreign key onto this table — so
-- every finding citing one of them failed to insert. The insert is a
-- single batch and best-effort, so ONE Gulf citation discarded the
-- entire findings set, including valid GDPR/UK GDPR entries in the same
-- audit, while the audit row itself saved fine.
--
-- The customer-facing result, reproduced on 10 Sep 2026 with
-- Saudi PDPL + UK GDPR: a report with risk score 78/100, an executive
-- summary describing transfers to US subprocessors without SDAIA
-- approval, and beneath it "0 findings — your document is compliant".
--
-- Names, jurisdictions, authorities and citation styles are copied
-- verbatim from the application catalogue so the two cannot drift.

insert into public.legal_frameworks (id, name, jurisdiction, authority, citation_style) values
  ('qatar_pdppl',
   'Qatar PDPPL (Personal Data Privacy Protection Law - Law No. 13 of 2016)',
   'QA',
   'National Cyber Security Agency (NCSA) — Compliance and Data Protection Department',
   'article'),
  ('saudi_pdpl',
   'Saudi PDPL (Personal Data Protection Law - Royal Decree M/19, as amended 2023)',
   'SA',
   'Saudi Data & AI Authority (SDAIA)',
   'article'),
  ('uae_pdpl',
   'UAE PDPL (Federal Decree-Law No. 45 of 2021 on Personal Data Protection)',
   'AE',
   'UAE Data Office',
   'article'),
  ('bahrain_pdpl',
   'Bahrain PDPL (Personal Data Protection Law - Law No. 30 of 2018)',
   'BH',
   'Personal Data Protection Authority (PDPA)',
   'article'),
  ('kuwait_dppr',
   'Kuwait DPPR (Data Privacy Protection Regulation - CITRA Resolution No. 26 of 2024)',
   'KW',
   'Communication and Information Technology Regulatory Authority (CITRA)',
   'article'),
  ('oman_pdpl',
   'Oman PDPL (Personal Data Protection Law - Royal Decree No. 6 of 2022)',
   'OM',
   'Ministry of Transport, Communications and Information Technology (MTCIT)',
   'article')
on conflict (id) do update set
  name           = excluded.name,
  jurisdiction   = excluded.jurisdiction,
  authority      = excluded.authority,
  citation_style = excluded.citation_style;
