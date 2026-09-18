-- Six Gulf regimes are sold. None of them was watched.
--
-- Saudi PDPL, UAE PDPL, Qatar PDPPL, Bahrain PDPL, Kuwait DPPR and Oman
-- PDPL are in the framework registry, on the pricing page and in the audit
-- engine, and the legal-watch corpus behind them was empty — every source
-- in this table was European bar Japan. That gap is also, measurably, where
-- the product's only organic visibility comes from: of the handful of pages
-- Google has indexed, the ones it chose were /fr/compare/oman_pdpl-vs-uae_pdpl
-- and /ar/compare/appi-vs-gdpr. Nobody else writes those. Everybody writes
-- GDPR.
--
-- THESE ARE CANDIDATES, AND THE DISTINCTION IS THE POINT
--
-- The sandbox this was written from reaches no regulator domain, so each
-- URL below is a considered starting point and not a verified one. They are
-- inserted with verified_at null, which (see 0028) keeps them silent, gives
-- them twenty polls rather than five, and makes the poller search the
-- conventional places a government site keeps its news and write down what
-- answered. The machine with the network access does the verifying; nothing
-- reaches the site without passing the human review queue either way.
--
-- ON THE LICENCE COLUMN
--
-- Every European source here carries a real reuse licence — Etalab 2.0, the
-- UK's Open Government Licence, Decision 2011/833/EU. No Gulf authority
-- publishes one. Writing a plausible licence string to make the column look
-- uniform would be the most dangerous thing in this table: a compliance
-- company citing a permission that does not exist. So the field says what is
-- true, and what the pipeline actually does — facts, which are not
-- copyrightable, and never the authority's paragraphs, which are.

insert into public.legal_sources
  (id, name, jurisdiction, framework_ids, feed_url, feed_kind, item_pattern, licence, enabled)
values
  ('sdaia_sa', 'SDAIA (Saudi Arabia)', 'SA', array['saudi_pdpl'],
   'https://sdaia.gov.sa/en/MediaCenter/News/Pages/default.aspx', 'html', '/News/',
   'No published reuse licence. Facts only (dates, amounts, articles cited, outcome); source prose is extraction input and is never rendered or indexed; the primary URL is always cited.', true),

  ('uae_dataoffice', 'UAE Data Office', 'AE', array['uae_pdpl'],
   'https://www.dataoffice.gov.ae/en/media-centre/news', 'html', '/news/',
   'No published reuse licence. Facts only (dates, amounts, articles cited, outcome); source prose is extraction input and is never rendered or indexed; the primary URL is always cited.', true),

  ('ncsa_qa', 'NCSA — Compliance and Data Protection (Qatar)', 'QA', array['qatar_pdppl'],
   'https://www.ncsa.gov.qa/en/media-center/news', 'html', '/news/',
   'No published reuse licence. Facts only (dates, amounts, articles cited, outcome); source prose is extraction input and is never rendered or indexed; the primary URL is always cited.', true),

  ('pdpa_bh', 'Personal Data Protection Authority (Bahrain)', 'BH', array['bahrain_pdpl'],
   'https://www.pdp.gov.bh/en/news', 'html', '/news/',
   'No published reuse licence. Facts only (dates, amounts, articles cited, outcome); source prose is extraction input and is never rendered or indexed; the primary URL is always cited.', true),

  ('citra_kw', 'CITRA (Kuwait)', 'KW', array['kuwait_dppr'],
   'https://citra.gov.kw/sites/en/Pages/news.aspx', 'html', '/news',
   'No published reuse licence. Facts only (dates, amounts, articles cited, outcome); source prose is extraction input and is never rendered or indexed; the primary URL is always cited.', true),

  ('mtcit_om', 'MTCIT (Oman)', 'OM', array['oman_pdpl'],
   'https://www.mtcit.gov.om/en/media-center/news', 'html', '/news/',
   'No published reuse licence. Facts only (dates, amounts, articles cited, outcome); source prose is extraction input and is never rendered or indexed; the primary URL is always cited.', true)
on conflict (id) do nothing;
