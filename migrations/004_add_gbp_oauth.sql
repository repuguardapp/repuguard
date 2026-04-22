-- Migration 004: Google Business Profile OAuth for direct reply publishing
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS gbp_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS gbp_location_name TEXT;
-- gbp_refresh_token: AES-256-GCM encrypted refresh token (iv:tag:ciphertext in hex)
-- gbp_location_name: GBP resource name e.g. "accounts/123/locations/456"
-- Required env var: TOKEN_ENCRYPTION_KEY (64 hex chars = 32 bytes)
