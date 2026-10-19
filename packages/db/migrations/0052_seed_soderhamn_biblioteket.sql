-- Söderhamns stadsbibliotek Sitevision calendar. Trust stays review.
-- The row is disabled in the database; a manual run still saves.
-- robots.txt disallows jsessionid URLs, so later pages use skip on the clean list URL.

INSERT INTO "data_sources" ("id", "slug", "kind", "schedule", "config", "trust", "enabled")
VALUES (
  '33333333-3333-4333-8333-333333333305',
  'soderhamn-biblioteket',
  'scraper',
  '0 */6 * * *',
  '{"origin":"https://www.soderhamn.se","listPath":"/underwebbar/biblioteket/evenemang-pa-biblioteket.html","portletId":"12.5ca6a40216737843363b2f36","pageSize":10}'::jsonb,
  'review',
  false
)
ON CONFLICT ("slug") DO NOTHING;
