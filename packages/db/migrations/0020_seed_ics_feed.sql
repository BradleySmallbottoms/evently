-- Generic ICS feed adapter. Disabled until a real feedUrl is configured.
-- Set config.feedUrl to an https calendar URL and enable when ready.

INSERT INTO "data_sources" ("id", "slug", "kind", "schedule", "config", "trust", "enabled")
VALUES (
  '33333333-3333-4333-8333-333333333302',
  'ics-feed',
  'feed',
  '0 */6 * * *',
  '{"feedUrl":"https://example.com/calendar.ics"}'::jsonb,
  'review',
  false
)
ON CONFLICT ("slug") DO NOTHING;
