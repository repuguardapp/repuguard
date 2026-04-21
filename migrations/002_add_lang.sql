-- Add language preference to clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lang VARCHAR(5) DEFAULT 'fr';
