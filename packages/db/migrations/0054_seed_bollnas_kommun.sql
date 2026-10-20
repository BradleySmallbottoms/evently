-- Bollnäs kommun Soleil eventsCalendar JSON. Trust stays review.
-- The row is disabled in the database; a manual run still saves.
-- robots.txt disallows jsessionid URLs. Pages use start on the clean items route.

INSERT INTO "data_sources" ("id", "slug", "kind", "schedule", "config", "trust", "enabled")
VALUES (
  '33333333-3333-4333-8333-333333333306',
  'bollnas-kommun',
  'api',
  '0 */6 * * *',
  '{"origin":"https://bollnas.se","resourcePath":"/appresource/4.825d63f17dc1e8befb7a0c5/12.825d63f17dc1e8befb7a248","pageSize":20}'::jsonb,
  'review',
  false
)
ON CONFLICT ("slug") DO NOTHING;
