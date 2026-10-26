# Collapse occasions in admin

Staff open an event and pick one or more other events to fold into it. The admin session cookie is
required. The Tillfallen tab lists this event's rows from `event_occasions`.

Collapse moves selected events' occasion rows onto the open event. A moved showing with no venue takes the venue from the first target showing that has one, in start order. It repoints child rows (saves,
coming, check-ins, ratings, reports, tags, translations, images, links, refs, stats, and push),
and deletes the checked event rows. Their source ids move with `external_refs`, so a later import
updates the surviving event. Any surviving event drops `meta.possibleDuplicate` when that note
pointed at a folded event.

```mermaid
sequenceDiagram
  participant Admin
  participant API as Admin API
  participant DB
  participant SQS
  Admin->>API: GET /v1/events/{id}
  API->>DB: events + event_occasions
  API-->>Admin: detail with occasion rows
  Admin->>API: choose events to merge
  Admin->>API: POST /v1/events/{id}/collapse
  Note over API: Body is the checked event ids.
  API->>DB: move occasion rows to host event_id
  API->>DB: repoint child rows (saved/coming/check-ins/ratings/reports/refs/stats/push)
  API->>DB: delete merged event rows + write audit log
  API->>DB: drop possibleDuplicate notes that pointed at a merged event
  alt host is published
    API->>SQS: event.updated
  end
  API-->>Admin: updated host event
```

The surviving event keeps one id. Future imports of a merged source id update that event.
