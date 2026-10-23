-- A source we have decided about, as opposed to one still waiting.
--
-- The digest counts "9 off" and asks for a decision on all of them
-- every morning. Nine of those were never going to be repaired: six
-- Gulf regulators whose PDPLs are recent and who publish no
-- machine-readable enforcement at all, the EDPS refusing our collector
-- on purpose, a free-zone press office, and Japan's PPC which simply
-- does not publish individual sanctions the way EU authorities do.
--
-- Leaving them in the "needs a decision" bucket means the report asks
-- a question that has been answered, which is the same defect the
-- delta format was built to remove — one layer down.
--
-- `abandoned_at` set means: a human-level decision was taken, this
-- jurisdiction is not watched, and nothing further is owed. The row is
-- kept rather than deleted so the decision and its reason survive, and
-- so re-enabling later is a one-line change rather than an
-- archaeology exercise.
--
-- WHAT THIS DOES NOT TOUCH
--
-- The framework stays in FRAMEWORKS and /compliance/<id> keeps
-- working. Verified on 23 October: no public string in messages/*.json
-- claims we monitor any regulator — the pages describe auditing a
-- document against a framework's provisions, which come from
-- legal-frameworks.ts and not from a feed. Abandoning a source costs
-- enforcement decisions from that jurisdiction. It makes no page false.
--
-- The Stripe product descriptions DID claim "surveillance
-- multi-juridictions, alertes temps réel" and "toutes juridictions
-- GDPR/PDPL/PDPPL", on the checkout page. They were rewritten the same
-- day to describe what is delivered: audits per month, 15 frameworks,
-- sourced citations, 7 languages.

alter table public.legal_sources
  add column if not exists abandoned_at     timestamptz,
  add column if not exists abandoned_reason text;

comment on column public.legal_sources.abandoned_at is
  'Set when a decision was taken not to watch this jurisdiction. Such a source leaves the digest''s "needs a decision" count; it is kept, not deleted, so the reasoning survives and re-enabling stays trivial. See migration 0055.';
