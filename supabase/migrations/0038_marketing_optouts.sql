-- Opposition to marketing email, kept apart from deliverability.
--
-- email_suppressions already exists and records addresses that bounced,
-- complained or are structurally invalid. That table answers "can we
-- reach this mailbox". This one answers a different question — "does
-- this person want to hear from us" — and the two must not be merged.
--
-- Merging them would mean an opt-out from the upgrade sequence also
-- silencing the magic link that signs the person in and the email that
-- delivers the audit they paid for. Article 21(2) is about direct
-- marketing; it does not ask us to stop answering someone who is trying
-- to use the product. Suppressing their sign-in link would not be extra
-- caution, it would be a broken account.
--
-- One row per address that has said no. No reason column and no free
-- text: there is only one reason here and we do not ask for another.

create table if not exists public.marketing_optouts (
  email        text primary key,
  opted_out_at timestamptz not null default now(),
  -- Which mechanism recorded it. 'one_click' is the RFC 8058 POST a mail
  -- client makes on the recipient's behalf; 'link' is the footer link.
  -- Kept because Google and Yahoo ask senders to honour the first, and
  -- because a list that is all 'link' would mean the header is not
  -- working.
  source       text not null check (source in ('one_click', 'link', 'manual'))
);

comment on table public.marketing_optouts is
  'Addresses that objected to marketing email. Deliberately separate from email_suppressions: an objection to marketing never blocks transactional mail.';

-- No RLS policy granting anything: this table is written and read by the
-- service role only. There is no user-facing query that should ever list
-- who has unsubscribed.
alter table public.marketing_optouts enable row level security;
