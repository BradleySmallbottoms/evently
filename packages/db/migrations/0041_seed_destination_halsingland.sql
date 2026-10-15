-- Destination Hälsingland public calendar JSON (no Citybreak API key). Trust stays review.
-- The row is disabled in the database; a manual run still saves.

INSERT INTO "data_sources" ("id", "slug", "kind", "schedule", "config", "trust", "enabled")
VALUES (
  '33333333-3333-4333-8333-333333333304',
  'destination-halsingland',
  'api',
  '0 */6 * * *',
  '{"origin":"https://visit.destinationhalsingland.se","language":"sv","filter":"c=4559","sorting":"st=a;so=a;split=hl","pageSize":10}'::jsonb,
  'review',
  false
)
ON CONFLICT ("slug") DO NOTHING;
