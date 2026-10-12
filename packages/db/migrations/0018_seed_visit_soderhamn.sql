-- Visit Söderhamn (Citybreak CBIS). Disabled until ingestion persistence is wired.
-- The API key is VISIT_SODERHAMN_API_KEY, not this config.

INSERT INTO "data_sources" ("id", "slug", "kind", "schedule", "config", "trust", "enabled")
VALUES (
  '33333333-3333-4333-8333-333333333301',
  'visit-soderhamn',
  'api',
  '0 */6 * * *',
  '{"baseUrl":"https://cbis-rest-api.citybreak.com/v1/api","eventCategoryId":30172,"pageSize":20,"language":"sv-se"}'::jsonb,
  'review',
  false
)
ON CONFLICT ("slug") DO NOTHING;
