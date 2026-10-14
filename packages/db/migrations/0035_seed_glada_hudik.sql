-- Glada Hudik public calendar (no Citybreak API key). Trust stays review.
-- The row is disabled in the database; a manual run still saves.

INSERT INTO "data_sources" ("id", "slug", "kind", "schedule", "config", "trust", "enabled")
VALUES (
  '33333333-3333-4333-8333-333333333303',
  'glada-hudik',
  'scraper',
  '0 */6 * * *',
  '{"origin":"https://www.gladahudik.se","nodeId":841,"language":"sv"}'::jsonb,
  'review',
  false
)
ON CONFLICT ("slug") DO NOTHING;
