-- 0018 — read a session's age so the application can expire it.
--
-- Supabase Auth sessions last indefinitely by default: the access token
-- expires hourly, the refresh token never does, and the browser renews
-- itself for ever. Supabase enforces a time-box and an inactivity
-- timeout natively on Pro plans and up; we are on the free plan, so the
-- application enforces it instead.
--
-- All it needs is the two timestamps, and auth.sessions is not exposed
-- through PostgREST — by design, and we are not going to change that.
-- A SECURITY DEFINER function with a single-row, primary-key read is
-- the narrowest possible opening: it returns two timestamps for one
-- session id and nothing else. No user id, no IP, no user agent, no
-- way to enumerate.
--
-- Execute is granted to service_role alone. anon and authenticated are
-- revoked explicitly rather than left to the default, because the
-- default for a new function is EXECUTE to PUBLIC and relying on
-- "nobody thought to call it" is not access control.

create or replace function public.auth_session_lifetime(p_session_id uuid)
returns table (created_at timestamptz, refreshed_at timestamptz)
language sql
security definer
set search_path = auth, pg_temp
stable
as $$
  select s.created_at, s.refreshed_at::timestamptz
  from auth.sessions s
  where s.id = p_session_id;
$$;

comment on function public.auth_session_lifetime(uuid) is
  'Age of one auth session, for the application-side time-box and inactivity timeout (see src/lib/session-policy.ts). Returns two timestamps and nothing else; service_role only.';

revoke all on function public.auth_session_lifetime(uuid) from public;
revoke all on function public.auth_session_lifetime(uuid) from anon, authenticated;
grant execute on function public.auth_session_lifetime(uuid) to service_role;
