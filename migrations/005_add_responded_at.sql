-- Migration 005: Track when a review was responded to
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;
