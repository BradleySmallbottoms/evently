-- Tickster Event API. Trust stays review.
-- The row is disabled in the database; a manual run still saves.
-- The API key is TICKSTER_API_KEY, not this config.

INSERT INTO "data_sources" ("id", "slug", "kind", "schedule", "config", "trust", "enabled")
VALUES (
  '33333333-3333-4333-8333-333333333307',
  'tickster',
  'api',
  '0 */6 * * *',
  '{"cities":["Söderhamn","Bollnäs","Hudiksvall","Ljusdal"],"language":"sv","pageSize":50}'::jsonb,
  'review',
  false
)
ON CONFLICT ("slug") DO NOTHING;
