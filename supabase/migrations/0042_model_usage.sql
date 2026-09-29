-- What each model call actually cost us, in tokens.
--
-- The question "is the Starter plan profitable at ten audits a month"
-- cannot be answered from the code. The code says the output budget is
-- 16 384 tokens for one framework and 8 192 more per extra one; it says
-- nothing about how many the model actually spends, or how large a real
-- customer document is once extracted. Everything I could tell the
-- founder about margin so far has been arithmetic over my own estimates.
--
-- The API returns the true figure on every response. Recording it turns a
-- simulation into a measurement, which is the difference between "an
-- audit probably costs about X" and "the last forty audits cost this".
--
-- WHAT IS NOT STORED
--
-- No prompt, no completion, no document, no customer text of any kind.
-- Four numbers and a label. This table exists to be summed, and anything
-- in it that could identify a person or reproduce a document would be a
-- second copy of material the retention policy already governs elsewhere.

create table if not exists public.model_usage (
  id             uuid primary key default gen_random_uuid(),
  -- Which part of the product spent it.
  purpose        text not null check (purpose in (
                   'extract_legal', 'audit_pass1', 'audit_localize',
                   'audit_rewrite', 'reply_classify', 'other'
                 )),
  -- The model as the provider named it, not as we aliased it. A cost
  -- attributed to the wrong model is worse than no cost.
  model          text not null,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  -- Set when the spend belongs to one audit, so cost per audit is a
  -- query rather than a division.
  audit_id       uuid references public.audits (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists model_usage_created_idx on public.model_usage (created_at desc);
create index if not exists model_usage_purpose_idx on public.model_usage (purpose, created_at desc);
create index if not exists model_usage_audit_idx on public.model_usage (audit_id);

comment on table public.model_usage is
  'Token counts per model call, as reported by the provider. No prompts, no completions, no customer text — four numbers and a label, so that cost per audit is measured rather than estimated.';

alter table public.model_usage enable row level security;
