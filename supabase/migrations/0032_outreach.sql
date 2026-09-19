-- Automated market validation: the machine asks, nobody converses.
--
-- The instruction is zero manual prospecting. So the question "will a
-- compliance professional pay for this" has to be answered by measurement
-- rather than by interview, and that changes what we measure.
--
-- A survey asks what someone would do. This asks what they did: whether a
-- stranger who received one email went on to run an audit on their own
-- document. Stated preference is worth nothing at this stage; six people
-- completing an audit is worth more than sixty saying the idea is good.
--
-- WHY THREE TABLES AND NOT ONE
--
-- A contact is a person. A send is one message to them. An event is
-- something that happened afterwards. Collapsing those means a second
-- email overwrites the first one's outcome, and the funnel becomes
-- unreadable at exactly the point it starts working.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No open-tracking pixel. Apple Mail Privacy Protection fetches every
-- image in every message, so an "open rate" from a pixel is a measure of
-- how many recipients use Apple Mail. Publishing that number to ourselves
-- would be the same class of error as the ICO source reporting `ok` on its
-- own skip link. Clicks are first-party and real; opens are not recorded
-- at all rather than recorded wrongly.

create table if not exists public.outreach_contacts (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  -- Where this address came from, in the contact's own words if possible.
  -- A prospection file with no provenance cannot be defended to anyone,
  -- and under Article 14 the person may ask us where we got it.
  source        text not null,
  source_url    text,
  company       text,
  role_hint     text,
  locale        text not null default 'en',
  country       text,
  status        text not null default 'new'
                check (status in ('new','queued','sent','replied','converted','unsubscribed','bounced','suppressed')),
  -- Article 21: opposition must be as easy as the message was to send, and
  -- it is final. Nothing re-queues a contact once this is set.
  opted_out_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists outreach_contacts_status_idx on public.outreach_contacts (status);

-- One row per message actually handed to the sending provider.
create table if not exists public.outreach_sends (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references public.outreach_contacts (id) on delete cascade,
  -- Which message in the sequence: 1 is the question, 2 is the sample, 3
  -- is the close. Numbered rather than named so the sequence can be
  -- rewritten without a migration.
  step          integer not null check (step between 1 and 5),
  -- The token that identifies this send in a click. Opaque and unguessable:
  -- it appears in a URL and must not leak the address it belongs to.
  token         text not null unique,
  provider_id   text,
  sent_at       timestamptz not null default now(),
  unique (contact_id, step)
);

create index if not exists outreach_sends_contact_idx on public.outreach_sends (contact_id);

-- Everything that happened afterwards, append-only.
create table if not exists public.outreach_events (
  id          uuid primary key default gen_random_uuid(),
  send_id     uuid references public.outreach_sends (id) on delete cascade,
  contact_id  uuid not null references public.outreach_contacts (id) on delete cascade,
  kind        text not null
              check (kind in ('click','audit_started','audit_completed','replied','unsubscribed','bounced','complained')),
  detail      text,
  created_at  timestamptz not null default now()
);

create index if not exists outreach_events_kind_idx on public.outreach_events (kind, created_at desc);
create index if not exists outreach_events_contact_idx on public.outreach_events (contact_id);

-- RLS on, no policies: the service role writes, nothing reads from a
-- browser. This table holds a prospection file, which is personal data
-- belonging to people who have not asked us for anything.
alter table public.outreach_contacts enable row level security;
alter table public.outreach_sends enable row level security;
alter table public.outreach_events enable row level security;

comment on table public.outreach_contacts is
  'Automated outreach recipients. source/source_url exist because Article 14 requires us to be able to say where an address came from.';
comment on table public.outreach_events is
  'Append-only funnel. No open tracking: Apple MPP makes a pixel a measure of mail client, not of interest.';
