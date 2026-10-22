-- Claim one slot against today's free allowance, atomically.
--
-- The insert and the read are one statement. Two requests arriving in
-- the same millisecond cannot both see the same remaining slot: the
-- second blocks on the row lock the first took, then reads the value
-- the first wrote. A SELECT-then-UPDATE in application code would let
-- both through, which is the shape of every quota bug ever written.
--
-- It returns the count AFTER incrementing, so the caller compares
-- `used <= cap` rather than `used < cap`. The 25th audit of the day is
-- allowed; the 26th is not.
--
-- SECURITY DEFINER because the table has RLS enabled and no policy —
-- nothing but this function is meant to touch it. Execute is revoked
-- from anon and authenticated for the same reason credit functions are
-- (migrations 0001 and 0002): a visitor has no business spending the
-- allowance directly, and no business reading how much of it is left.

create or replace function public.claim_anonymous_audit()
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.anonymous_audit_quota (day, used, first_seen_at, last_seen_at)
  values (current_date, 1, now(), now())
  on conflict (day) do update
    set used = anonymous_audit_quota.used + 1,
        last_seen_at = now()
  returning used;
$$;

revoke execute on function public.claim_anonymous_audit() from public;
revoke execute on function public.claim_anonymous_audit() from anon;
revoke execute on function public.claim_anonymous_audit() from authenticated;
