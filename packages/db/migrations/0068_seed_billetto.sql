-- Billetto public event API. Trust stays review.
-- The row is disabled in the database; a manual run still saves.
-- The key pair is BILLETTO_API_KEY and BILLETTO_API_SECRET_KEY, not this config.

INSERT INTO "data_sources" ("id", "slug", "kind", "schedule", "config", "trust", "enabled")
VALUES (
  '33333333-3333-4333-8333-333333333315',
  'billetto',
  'api',
  '0 */6 * * *',
  '{"cities":["Söderhamn","Bollnäs","Hudiksvall","Ljusdal"]}'::jsonb,
  'review',
  false
)
ON CONFLICT ("slug") DO NOTHING;
