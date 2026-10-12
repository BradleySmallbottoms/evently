---
name: add-data-source
description: Add a new event data source (API, ICS/RSS feed or website scraper) to the data workers in apps/data-workers. Use this whenever the user wants to import, scrape, crawl, sync or pull events from an external site, calendar, feed, municipality, venue, ticketing platform or API, or mentions a "source", "adapter", "scraper" or "data worker".
---

# Add a data source

An adapter only **fetches** and **maps** to `IncomingEvent`. Validation, geocoding, publisher
resolution (`publisher_aliases`), dedupe, upsert and domain events are the pipeline's job.

## 1. Check the source first

- Prefer, in order: official API → ICS feed → RSS/JSON feed → HTML scraping. Look for an
  "iCal/ICS", "RSS" or API link before writing a scraper.
- Read the site's terms and `robots.txt`. If scraping isn't allowed, stop and tell the user.
- Note how organizers are identified; that becomes `organizerKey` (stable per organizer).

## 2. Create the adapter

```
apps/data-workers/src/sources/<slug>/index.ts     # defineAdapter({ slug, kind, fetchRaw, map })
apps/data-workers/src/sources/<slug>/fixture.json # a small real sample for tests (trimmed)
apps/data-workers/src/sources/<slug>/index.test.ts
```

Copy `example-fixture/` as the starting point. Then:

- `slug`: kebab-case, matches the `data_sources.slug` row.
- `kind`: `api` | `feed` | `scraper`.
- `fetchRaw(ctx)`: use `ctx.fetch` (adds User-Agent and timeout); read URLs/ids from `ctx.config`,
  never hard-code secrets.
- `map(raw)`: return `IncomingEvent[]`. Times as ISO with offset (`Europe/Stockholm`), `sourceUrl`
  always set, `location` as `{ lat, lng }` when known, `categoryHints` from the source's tags.
  Put known ticket, registration, and info URLs on `links`. The pipeline also extracts http(s)
  links from `description` for every source.
- Libraries: `ical.js` for ICS, a feed parser for RSS, `cheerio` for static HTML. Playwright only
  when nothing else works; it needs the separate browser image.

## 3. Register and test

- Add the adapter to `apps/data-workers/src/sources/index.ts`.
- Test `map()` against the fixture: every item parses with `IncomingEvent`, ids are stable, times
  have the right offset.
- Run: `pnpm --filter @local-events/data-workers test` and
  `pnpm --filter @local-events/data-workers dev -- --source <slug>`.

## 4. Configure

- Add a `data_sources` row (via admin or a seed): `kind`, `schedule` (cron, e.g. every 6 h),
  `config`, `trust: 'review'` (new sources always start in review), `enabled`.
- Update `docs/decisions.md` → "Still open" if this answers the "first data sources" question.
