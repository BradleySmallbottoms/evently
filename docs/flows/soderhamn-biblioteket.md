# Söderhamns stadsbibliotek import

The public calendar on soderhamn.se is the `soderhamn-biblioteket` source. There is no API. The
worker reads the Sitevision HTML the calendar page already serves.

The `data_sources` row is seeded disabled, trust `review`, schedule every 6 hours. A manual run
still fetches and saves. Saved events are `pending_scan` with `origin = imported`. The scan job
moves them to `in_review` or `published`. Flow: [event-scan.md](./event-scan.md).

`robots.txt` allows the calendar and disallows `jsessionid` URLs. The first page is the clean list
path. Later pages are that path with `sv.url` set to the portlet id and `skip` set to the page
offset. The worker does not request a session id.

Each list item is one event page. That page is saved before the next page is fetched. The
Sitevision page id is the external id, so two showings of the same title on the same day stay
separate. Date, time, place, and price come from the event page. A date that cannot be read is
still saved, with empty start and end. Times use the Europe/Stockholm offset. A date with no clock
is a whole day.

The organizer key is the library desk email, `biblioteket@soderhamn.se`. The chief's address on the
same contact card is not used. An `Arrangör` line in the text is the organizer name. Otherwise the
name is Söderhamns stadsbibliotek.

The place street, postcode, and city are stored on `meta.address`. The import does not geocode. The scan geocodes a missing point later. The seeded row
stays disabled until a manual run succeeds.

```mermaid
sequenceDiagram
  participant Runner as data-workers
  participant Site as soderhamn.se
  participant Geo as Photon
  participant DB as Postgres

  Runner->>Site: GET evenemang-pa-biblioteket.html
  loop skip until a short page
    Runner->>Site: GET list?sv.url=&skip=
  end
  loop each event page, save before the next
    Runner->>Site: GET event page
    Note over Runner: page id is the external id<br/>date, time, place, price from the page<br/>unread date stays without start and end<br/>Europe/Stockholm offset
    Runner->>Geo: library or venue lookup
    Runner->>DB: insert this event (status pending_scan, origin imported)<br/>ref_id, worker_id, external_refs
  end
  Runner->>DB: finish ingestion_runs
```
