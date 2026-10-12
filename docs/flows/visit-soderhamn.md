# Visit Söderhamn import

Citybreak CBIS is the first external source (`visit-soderhamn`). A manual run fetches, maps and
saves. The `data_sources` row is seeded disabled (no timer yet), trust `review`, schedule every
6 hours. The API key is `VISIT_SODERHAMN_API_KEY`.

Saved events are `in_review` with `origin = imported`. Each new contact email becomes a temporary
publisher (`publisher_aliases`). Unchanged content hashes are skipped. A close match to an event
already in the database links `external_refs` and does not overwrite that event. `in_review` rows
are not sent to the notification queue. When `RAW_INGESTION_BUCKET` is set, the raw fetch is
stored at `raw/<slug>/<runId>`. A main image is copied into the public assets bucket
(`events/<eventId>/main`) and linked in `event_images`. A failed image download does not fail the
event. Locally that bucket is Garage; in AWS it is S3 behind CloudFront.

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
  Runner->>Store: PUT raw/visit-soderhamn/{runId}<br/>when RAW_INGESTION_BUCKET is set
  Runner->>DB: insert temporary publisher + publisher_aliases<br/>when the organizer key is new
  Runner->>DB: upsert tags from categories under Evenemang<br/>insert events (status in_review, origin imported)<br/>event_tags, external_refs
  Runner->>CBIS: GET the product main image
  Runner->>Store: PUT events/{eventId}/main
  Runner->>DB: upsert event_images (role main, source_url)
  Runner->>DB: finish ingestion_runs (created / updated / skipped)
```
