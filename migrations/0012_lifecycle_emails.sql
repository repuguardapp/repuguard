-- 0012_lifecycle_emails.sql
-- Three timestamp columns to make the lifecycle-emails cron idempotent.
-- Each column stores the moment the corresponding email actually left
-- Resend (never set on failure, so a re-run picks up automatically).

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS lifecycle_welcome_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS lifecycle_nudge_sent_at   timestamptz,
  ADD COLUMN IF NOT EXISTS lifecycle_upgrade_sent_at timestamptz;

-- Partial index so the cron's WHERE `<column> IS NULL` scan stays cheap
-- even at 10k+ orgs. Two indexes, one per stage the cron polls.
CREATE INDEX IF NOT EXISTS organizations_lifecycle_nudge_pending_idx
  ON public.organizations (created_at)
  WHERE lifecycle_nudge_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS organizations_lifecycle_upgrade_pending_idx
  ON public.organizations (created_at)
  WHERE lifecycle_upgrade_sent_at IS NULL;
