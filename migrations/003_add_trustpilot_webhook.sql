-- Migration 003: Trustpilot connector + outbound webhooks + auto-respond
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS trustpilot_business_id TEXT,
  ADD COLUMN IF NOT EXISTS trustpilot_score       FLOAT,
  ADD COLUMN IF NOT EXISTS webhook_url            TEXT,
  ADD COLUMN IF NOT EXISTS webhook_enabled        BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_respond_5star     BOOLEAN DEFAULT false;
