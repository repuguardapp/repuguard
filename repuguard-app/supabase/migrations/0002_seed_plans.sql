-- RepuGuard V2 — seed reference plans
-- Migration: 0002_seed_plans

insert into plans
  (id,         name,       max_platforms, max_locations, reviews_per_sync, sync_interval_h, ai_responses, email_alerts, white_label)
values
  ('starter',  'Starter',  1,             20,            10,               24,              false,        false,        false),
  ('pro',      'Pro',      3,             50,            50,               6,               true,         true,         false),
  ('business', 'Business', 5,             100,           200,              2,               true,         true,         true);
