-- A finding proves its fact and never had to prove that the article
-- governs the document.
--
-- WHY THIS SCHEMA CHANGES
--
-- `evidence` is verified character by character against the source, so
-- the FACT a finding rests on is checkable. Nothing has ever had to
-- establish the other half: that the provision cited actually applies
-- here. The engine was free to pair a real absence with an article that
-- does not govern us, and the result reads exactly like a breach.
--
-- THE RUN THAT SHOWED IT
--
-- The first real audit, 19 October 2026, on LexyFlow's own privacy
-- policy. Eleven findings, five of them `high`. One of the five:
--
--   title  "Aucun représentant UE/EEE identifié"
--   body   "LORSQUE le responsable de traitement n'est pas établi dans
--           l'UE/EEE mais cible des personnes concernées de l'UE,
--           l'article 27 impose en outre..."
--
-- The body states the condition correctly. The title asserts the
-- breach unconditionally. LexyFlow is established in France, so Article
-- 27 does not apply to it and there is no finding — but the title is
-- what the dashboard lists, what the reader skims and what headlines
-- the exported PDF, and it was scored `high`.
--
-- The same shape appeared under EU AI Act Art. 13, which binds
-- high-risk systems only.
--
-- WHAT THE TWO COLUMNS DO
--
-- `applies_because` makes the engine say, in one sentence, what makes
-- this provision govern THIS document. It is the applicability half of
-- what `evidence` already does for the factual half, and it is shown to
-- the reader so the reasoning can be judged rather than trusted.
--
-- `applicability_certain` is the engine's own answer to "does this
-- article's reach depend on a fact the document does not settle?" When
-- it is false the severity is forced to `info` in code — because a
-- provision that may not bind us cannot produce a high-severity gap,
-- and because the derived risk score must not be driven by obligations
-- nobody has established we are under.
--
-- Defaults are chosen so the eleven findings already stored keep their
-- meaning: they were written before the question was asked, and
-- `true` is what the engine was implicitly claiming at the time.

alter table public.audit_findings
  add column if not exists applies_because text,
  add column if not exists applicability_certain boolean not null default true;

comment on column public.audit_findings.applies_because is
  'One sentence stating what makes the cited provision govern this document. The applicability half of what evidence does for the factual half: shown to the reader so the reasoning is judged rather than trusted.';

comment on column public.audit_findings.applicability_certain is
  'False when the provision''s reach depends on a fact the document does not settle — where the controller is established, whether the system is high-risk. Forces severity to info, so an obligation nobody has established we are under cannot drive the risk score.';
