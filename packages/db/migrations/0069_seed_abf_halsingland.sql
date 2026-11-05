-- ABF Hälsingland events on the shared HTML calendar. Trust stays review. The row is disabled.
-- The course catalogue is not this list. Selectors live in config.

INSERT INTO "data_sources" ("id", "slug", "kind", "schedule", "config", "trust", "enabled")
VALUES
  (
    '33333333-3333-4333-8333-333333333316',
    'abf-halsingland',
    'scraper',
    '0 */6 * * *',
    '{"listUrl":"https://www.abf.se/halsingland/kurs-sok/?type=event&display=list","item":"article.EventCard","link":"a","next":"nav[aria-label=\"Sidnumrering\"] a.text-xs.underline[href]:last-of-type","detailIgnore":"[data-target=\"similar-courses\"]","organizerName":"ABF Hälsingland","maxPages":8,"fields":{"title":"h1","description":".CoursePage-MainContent","date":".HeroBlock-CourseInfo","address":"a.HeroBlock-CourseInfo-Text","price":".HeroBlock-CourseInfo","image":{"selector":"meta[property=\"og:image\"]","attr":"content"}}}'::jsonb,
    'review',
    false
  )
ON CONFLICT ("slug") DO NOTHING;
