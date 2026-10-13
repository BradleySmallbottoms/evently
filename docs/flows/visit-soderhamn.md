# Visit Söderhamn import

Citybreak CBIS is the first external source (`visit-soderhamn`). A manual run fetches, maps and
saves. The `data_sources` row is seeded disabled (no timer yet), trust `review`, schedule every
6 hours. The API key is `VISIT_SODERHAMN_API_KEY`.

Saved events are `in_review` with `origin = imported`. Each new contact email becomes a temporary
publisher (`publisher_aliases`). Unchanged content hashes are skipped. A close match to an event
already in the database links `external_refs` and does not overwrite that event. `in_review` rows
are not sent to the notification queue. When `RAW_INGESTION_BUCKET` is set, the raw fetch is
stored at `raw/<slug>/<runId>`. A main image is copied into the public assets bucket
(`events/<eventId>/main`) and linked in `event_images`. Further images from linked pages are stored
as `gallery-1`, `gallery-2`, and so on. A failed image download does not fail the event. A failed
page crawl leaves the previous gallery rows in place. Locally that bucket is Garage; in AWS it is S3 behind CloudFront.

Category paging uses a continue token that embeds the API key. The worker must not log that token.

```mermaid
sequenceDiagram
  participant Runner as data-workers
  participant CBIS as Citybreak CBIS
  participant Store as Garage or S3
  participant DB as Postgres

  Runner->>CBIS: GET /v1/api/raw/category/getpaged/20<br/>ApiKey, Accept-Language sv-se
  loop until an empty page
    Runner->>CBIS: GET /v1/api/raw/category/getnext/{token}
  end
  Note over Runner: require category 30172 Evenemang
  loop POST /v1/api/product page until TotalResults
    Runner->>CBIS: Categories [30172], Page, PageSize 20
  end
  Note over Runner: one IncomingEvent per occasion<br/>Europe/Stockholm offset<br/>organizer key = contact email<br/>Bokningslänk → tickets<br/>event link and website → info<br/>description URLs → event links<br/>gratis or “N kr” → price, otherwise unknown
  loop each event link, https only
    Runner->>Runner: GET the page<br/>og:image, then img
  end
  Note over Runner: hero stays the Citybreak image<br/>if that image is missing, first og:image, then first img<br/>further crawled images are gallery-1, gallery-2, …
  Runner->>Store: PUT raw/visit-soderhamn/{runId}<br/>when RAW_INGESTION_BUCKET is set
  Runner->>DB: insert temporary publisher + publisher_aliases<br/>when the organizer key is new
  Runner->>DB: upsert tags from categories under Evenemang<br/>insert events (status in_review, origin imported)<br/>event_tags, external_refs
  Runner->>CBIS: GET the product main image, or a crawled image when Citybreak has none
  Runner->>Store: PUT events/{eventId}/main and events/{eventId}/gallery-N
  Runner->>DB: upsert event_images (role main or gallery-N, source_url)
  Runner->>DB: finish ingestion_runs (created / updated / skipped)
```
