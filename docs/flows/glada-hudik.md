# Glada Hudik import

The public calendar on gladahudik.se is the `glada-hudik` source. There is no Citybreak API key.
The `data_sources` row is seeded disabled, trust `review`, schedule every 6 hours. A manual run
still fetches and saves. Saved events are `pending_scan` with `origin = imported`. The scan job
moves them to `in_review` or `published`. Flow: [event-scan.md](./event-scan.md).

The list request sends only `nodeId` and `page`. `robots.txt` disallows filtered queries
(`order`, `occasion`, `filter`, `search`, `categories`, `geo`, `arena`).

A dense run of daily opening hours longer than `occasionSpanDays` (default 21) that covers at
least `occasionCoverage` of those days (default 0.6) becomes one event (`externalId`
`cbis:{id}:span`), sets `meta.collapsed`, and stores every occasion on `meta.occasions`. A concert, a film week, or a monthly circle stays one event per occasion, and
each of those events stores the product id on `meta.occasionGroupId`. A page with no occasion is still saved, with empty start and end. The scan fills both when it can read them from the text. Both knobs live on
`data_sources.config`.
The hero is the event page `og:image`. `data-lat` and `data-lng` on the page map become the
event point. A page without that map is saved without a point. The contact street, postcode, and city are stored on `meta.address`. The scan geocodes a missing point later.
A digital showing stays without a point.

A booking link (`Bokningslänk`) is `tickets`. Event, website, and Facebook links in
the description or contact block are `info`. The destination site’s footer links are left out.
Organizer key is the contact email when the page has one.

The worker reads the whole list first. It then takes one event at a time: the event page, then
saves that event as `pending_scan` before the next page is fetched. Tags, the publisher, and
the duplicate check run in the scan job.

```mermaid
sequenceDiagram
  participant Runner as data-workers
  participant Site as gladahudik.se
  participant DB as Postgres

  loop pages until totalCount
    Runner->>Site: GET /sv/api/cbis-product-list?nodeId=841&page=
  end
  loop each event, save before the next page
    Runner->>Site: GET /sv/{event}
    Note over Runner: one event per occasion<br/>daily opening hours over occasionSpanDays (default 21) at occasionCoverage (default 0.6) become one span<br/>separate occasions share meta.occasionGroupId<br/>map data-lat / data-lng is kept; a missing point is geocoded after the scan<br/>Europe/Stockholm offset<br/>organizer keys = email, website, name<br/>Bokningslänk → tickets<br/>Facebook and other content links → info
    Runner->>DB: insert this event (status pending_scan, origin imported)<br/>external_refs, meta.import
  end
  Runner->>DB: finish ingestion_runs
```
