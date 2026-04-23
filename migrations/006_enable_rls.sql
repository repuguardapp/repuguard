-- Migration 006: Enable Row-Level Security on all tables
-- All DB access goes through the service role key (bypasses RLS) so nothing breaks.
-- This blocks any direct public/anon access to the tables.
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
