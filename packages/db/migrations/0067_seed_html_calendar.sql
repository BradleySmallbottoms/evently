-- Shared HTML calendar. Trust stays review. The rows are disabled; a manual run still saves.
-- Selectors live in config. The adapter is apps/data-workers/src/sources/html-calendar.

INSERT INTO "data_sources" ("id", "slug", "kind", "schedule", "config", "trust", "enabled")
VALUES
  (
    '33333333-3333-4333-8333-333333333311',
    'halsinglands-museum',
    'scraper',
    '0 */6 * * *',
    '{"listUrl":"https://halsinglandsmuseum.se/evenemang/","item":"a.event","link":"a","organizerName":"Hälsinglands museum","city":"Hudiksvall","fields":{"title":"h1","description":".block-content","date":{"selector":"time","attr":"datetime"},"price":".block-content"}}'::jsonb,
    'review',
    false
  ),
  (
    '33333333-3333-4333-8333-333333333312',
    'systrarna',
    'scraper',
    '0 */6 * * *',
    '{"listUrl":"https://systrarnas.se/kalendarium/","item":".e-loop-item","link":"a","detailIgnore":".e-loop-item","organizerName":"Systrarna Söderström","city":"Söderhamn","fields":{"title":"h1","description":".elementor-widget-theme-post-content","date":".elementor-icon-list-text","price":".elementor-widget-theme-post-content"}}'::jsonb,
    'review',
    false
  ),
  (
    '33333333-3333-4333-8333-333333333313',
    'folkteatern-gavleborg',
    'scraper',
    '0 */6 * * *',
    '{"listUrl":"https://folkteaterngavleborg.se/aktuellt/","item":"article.prog-item","link":"a","organizerName":"Folkteatern Gävleborg","fields":{"title":"h1.big-title","description":"#post_content","image":{"selector":"meta[property=\"og:image\"]","attr":"content"}}}'::jsonb,
    'review',
    false
  ),
  (
    '33333333-3333-4333-8333-333333333314',
    'ovanaker',
    'scraper',
    '0 */6 * * *',
    '{"listUrl":"https://www.ovanaker.se/kulturochfritid/upplevovanakerskommun/dettahander.11286.html","item":"li.eventcalendar-item","link":"a","organizerName":"Ovanåkers kommun","fields":{"title":"h1.heading","description":"#Ingress + .sv-text-portlet-content, #Innehall + .sv-text-portlet-content","price":"#Ingress + .sv-text-portlet-content, #Innehall + .sv-text-portlet-content","image":{"selector":"meta[property=\"og:image\"]","attr":"content"}}}'::jsonb,
    'review',
    false
  )
ON CONFLICT ("slug") DO NOTHING;
