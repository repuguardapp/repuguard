-- Migration 007: Add error_logs table for structured production error tracking
CREATE TABLE IF NOT EXISTS error_logs (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  source     text        NOT NULL,
  message    text,
  context    jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- Auto-purge rows older than 90 days to keep the table lean
CREATE INDEX IF NOT EXISTS error_logs_created_at_idx ON error_logs (created_at DESC);
