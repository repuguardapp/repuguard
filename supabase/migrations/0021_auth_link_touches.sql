-- Who opens a magic link, and with what.
--
-- 46 of 345 accounts confirmed their email. All 46 signed in. Four
-- organisations exist. So 42 sessions were created and never used —
-- not a form abandoned halfway, nothing at all. The median delay
-- between "magic link requested" and "email confirmed" was 23 seconds,
-- with values at 3, 7 and 8 seconds, across dozens of unrelated
-- corporate domains. Corporate mailboxes confirmed at 31.7%, consumer
-- mailboxes at 3.2%.
--
-- That is the signature of a corporate mail security scanner —
-- Defender Safe Links, Proofpoint URL Defense, Mimecast — fetching
-- every URL in an inbound message to test it. Our callback was a GET
-- that consumed the one-time token, so the scanner burned the link and
-- the human who clicked ten minutes later got an error.
--
-- The interstitial page fixes it. This table is how we know it did:
-- one row per open, with the stage it reached. A scanner leaves a
-- 'visited' row and never a 'confirmed' one; a person leaves both.
-- Without it the fix is a belief.
--
-- WHAT IS DELIBERATELY NOT STORED
--
-- No email, no token, no IP address. The user agent alone separates a
-- scanner from a browser — they announce themselves — and an IP would
-- be personal data collected with no basis beyond curiosity. We sell
-- GDPR audits; the inside of our own database is the last place to be
-- casual about that.

create table if not exists public.auth_link_touches (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  -- 'visited'   — the link was opened (GET on the callback)
  -- 'confirmed' — the interstitial form was submitted (POST)
  stage       text not null check (stage in ('visited', 'confirmed')),
  user_agent  text,
  -- 'magiclink', 'signup', 'recovery', 'invite' — or null if absent.
  link_type   text
);

create index if not exists auth_link_touches_created_idx
  on public.auth_link_touches (created_at desc);

-- RLS on with no policies: the service role writes, nothing else reads.
-- This is operational telemetry, not customer data, and it has no
-- business being reachable from a browser.
alter table public.auth_link_touches enable row level security;

comment on table public.auth_link_touches is
  'One row per magic-link open. stage=visited is any opener including mail scanners; stage=confirmed is a real form submission. Carries no email, token or IP.';

-- 0026, applied 17 September: the instrument could not answer its own
-- question.
--
-- Only success was recorded, so a missing `confirmed` row meant either
-- "the visitor never pressed the button" or "they pressed it and the
-- token was already spent" — opposite diagnoses, indistinguishable. And
-- the write was a floating promise, which on Vercel lands or does not
-- depending on when the function freezes: the same mistake that lost
-- Sentry events last week, reintroduced a day later in this file.
alter table public.auth_link_touches
  drop constraint if exists auth_link_touches_stage_check;

alter table public.auth_link_touches
  add constraint auth_link_touches_stage_check
  check (stage in ('visited', 'confirmed', 'failed'));

alter table public.auth_link_touches
  add column if not exists detail text;

comment on column public.auth_link_touches.detail is
  'For stage=failed: the provider error, e.g. "Token has expired or is invalid". No email, no token.';
