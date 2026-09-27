-- Who links to us, counted without tracking anybody.
--
-- The question is "did the study earn a link", and the honest instrument
-- for it is the Referer header: the browser tells us which page it came
-- from, we keep the HOSTNAME and throw the rest away.
--
-- WHAT IS DELIBERATELY NOT STORED
--
-- No IP address, no cookie, no session, no user agent, no timestamp per
-- visit. A referring URL can carry personal data in its query string — a
-- search term, an e-mail in a poorly built newsletter link — so the path
-- and query are discarded at the door rather than sanitised afterwards.
--
-- What remains is one row per (referring host, page), with a counter. It
-- says "lemonde.fr sent people to /observatory 14 times". It cannot say
-- who, when, or anything about a person, which is why it needs no consent
-- banner: there is no terminal access to store, and no personal data
-- processed. We measure our own marketing with our own logs, or not at all.

create table if not exists public.referrals (
  host        text not null,
  path        text not null,
  hits        integer not null default 0,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (host, path)
);

comment on table public.referrals is
  'Referring hostnames per page, counted. No IP, no cookie, no path or query from the referrer — a referring URL can carry personal data and is discarded at the door.';

alter table public.referrals enable row level security;

-- Upsert-and-increment in one statement, so two simultaneous clicks do
-- not read-modify-write over each other.
create or replace function public.record_referral(p_host text, p_path text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into referrals (host, path, hits)
  values (p_host, p_path, 1)
  on conflict (host, path) do update
    set hits = referrals.hits + 1,
        last_seen = now();
$$;

revoke all on function public.record_referral(text, text) from public, anon, authenticated;
