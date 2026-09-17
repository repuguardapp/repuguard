-- Addresses we must never write to again.
--
-- 345 magic links were sent and 46 confirmed. That looks like a list of
-- junk addresses and it mostly is not: the corporate ones were opened
-- by their employer's mail scanner, which burned the one-time token
-- before the human clicked. The interstitial fixed that on 16
-- September.
--
-- What did not exist at all is the other half: we have never consumed
-- Resend's bounce and complaint webhooks, so a hard bounce or a spam
-- complaint changed nothing on our side and the next send went to the
-- same address. That is the mechanism by which a sending domain's
-- reputation is destroyed — not by volume, but by continuing to write
-- to mailboxes that have already said no.
--
-- One row per address that has said no, with the reason and the event
-- that produced it. Checked before every send, in one place.
--
-- WHAT THIS TABLE IS NOT
--
-- It is not a blocklist of consumer domains. Blocking gmail, yahoo or
-- hotmail would suppress a freelance DPO or a one-person consultancy,
-- who are real customers of a €49/month compliance tool. An address
-- earns a row here by bouncing or complaining, not by the shape of its
-- domain.
--
-- PERSONAL DATA
--
-- An email address is personal data, and this table exists precisely
-- to stop processing it. Article 21(3) GDPR requires keeping enough to
-- honour an objection — suppressing an address requires remembering
-- it — so this is the narrow case where retention IS the privacy
-- measure. Nothing else about the person is stored.

create table if not exists public.email_suppressions (
  email        text primary key,
  -- 'bounced'    hard bounce: the mailbox does not exist
  -- 'complained' marked us as spam
  -- 'invalid'    structurally undeliverable (an SMS gateway, say)
  -- 'manual'     an operator decided
  reason       text not null check (reason in ('bounced', 'complained', 'invalid', 'manual')),
  detail       text,
  created_at   timestamptz not null default now()
);

-- RLS on with no policies: the service role writes and reads, nothing
-- else. A list of people who complained about us is not something a
-- browser needs.
alter table public.email_suppressions enable row level security;

comment on table public.email_suppressions is
  'Addresses that must never receive mail again. Populated by Resend bounce/complaint webhooks and by operators. Not a domain blocklist.';
