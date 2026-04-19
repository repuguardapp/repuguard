-- Migration 001 — Colonnes manquantes pour le rate limiting, webhooks et désabonnement
-- À exécuter dans l'éditeur SQL de Supabase

-- 1. Rate limiting pour generate-response
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS responses_today  INTEGER      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS responses_date   DATE;

-- 2. Suivi du renouvellement Stripe
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

-- 3. Désabonnement emails marketing
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS email_unsubscribed BOOLEAN DEFAULT false;

-- 4. Déduplication des webhooks Stripe
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  id         TEXT        PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Nettoyage automatique des événements > 7 jours (via pg_cron ou Supabase scheduled)
-- CREATE INDEX IF NOT EXISTS idx_pwe_created ON processed_webhook_events(created_at);
-- DELETE FROM processed_webhook_events WHERE created_at < now() - INTERVAL '7 days';
