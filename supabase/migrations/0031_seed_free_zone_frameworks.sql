-- The two Emirati free zones: DIFC and ADGM.
--
-- Separate statutes, separate regulators, separate commissioners — not
-- variants of the federal PDPL. They are also the two jurisdictions in the
-- Gulf that publish guidance and enforcement in English on a regular basis,
-- which is why the legal-watch corpus can actually cover them where it
-- struggles with the six national regimes.
--
-- WHY THIS MIGRATION EXISTS AT ALL
--
-- `audit_findings.framework_id` is a foreign key onto this table. When the
-- six Gulf frameworks were added to the application catalogue without being
-- seeded here, the picker offered Saudi PDPL, the engine audited against it,
-- and the findings insert — a single batch — failed wholesale on the foreign
-- key. That failure was best-effort and non-fatal, so the audit saved as
-- `completed` with an empty findings list, which the interface renders as
-- "no findings" under a risk score of 78/100. A customer was told their
-- document was clean because a row was missing from a reference table.
--
-- tests/framework-catalogue-parity.test.ts now fails in CI on that drift,
-- and it is what caught this addition before it shipped.
--
-- ON citation_style
--
-- The DIFC instrument is a Law divided into Articles. The ADGM instrument
-- is Regulations divided into Sections. Citing "Article 6 of the ADGM
-- Regulations" is the first thing a lawyer reading our report would notice,
-- so the two rows differ here on purpose.

insert into public.legal_frameworks (id, name, jurisdiction, authority, citation_style)
values
  ('difc_dp', 'DIFC Data Protection Law (DIFC Law No. 5 of 2020)', 'AE-DIFC',
   'Commissioner of Data Protection, DIFC', 'article'),
  ('adgm_dp', 'ADGM Data Protection Regulations 2021', 'AE-ADGM',
   'Office of Data Protection, ADGM', 'section')
on conflict (id) do nothing;

-- And the two sources behind them.
--
-- Candidates, like the six national regimes: verified_at stays null, so
-- they are silent and get twenty polls rather than five while the prober
-- reads each site's robots.txt and reports where its sitemaps actually are.
--
-- They are `sitemap` sources from the outset rather than after failing as
-- listings, because both sites are built in the browser and we already know
-- what that costs: five wasted runs and an auto-disable.
insert into public.legal_sources
  (id, name, jurisdiction, framework_ids, feed_url, feed_kind, item_pattern, licence, enabled)
values
  ('difc_dp_office', 'Commissioner of Data Protection (DIFC)', 'AE-DIFC', array['difc_dp'],
   'https://www.difc.com/sitemap.xml', 'sitemap', '/data-protection',
   'No published reuse licence. Facts only (dates, amounts, articles cited, outcome); source prose is extraction input and is never rendered or indexed; the primary URL is always cited.', true),
  ('adgm_dp_office', 'Office of Data Protection (ADGM)', 'AE-ADGM', array['adgm_dp'],
   'https://www.adgm.com/sitemap.xml', 'sitemap', '/media/announcements',
   'No published reuse licence. Facts only (dates, amounts, articles cited, outcome); source prose is extraction input and is never rendered or indexed; the primary URL is always cited.', true)
on conflict (id) do nothing;
