# Collapse occasions in admin

Staff open an event and pick one or more other events to fold into it. The admin session cookie is
required. The Tillfallen tab lists the event's occasion rows from `event_occasions`. Older grouped
imports can still use the group list to pick merge candidates.

```mermaid
sequenceDiagram
  participant Admin
  participant API as Admin API
  participant DB
  participant SQS
  Admin->>API: GET /v1/events/{id}
  API->>DB: events + event_occasions
  API-->>Admin: detail with occasion rows
  Admin->>API: GET /v1/events/{id}/occasion-group
  API->>DB: grouped candidates (legacy meta.occasionGroupId)
  API-->>Admin: mergeable events
  Admin->>API: POST /v1/events/{id}/collapse
  Note over API: Body is the checked event ids.
  API->>DB: move occasion rows to host event_id
  API->>DB: repoint child rows (saved/coming/check-ins/ratings/reports/refs/stats/push)
  API->>DB: delete merged event rows + write audit log
  alt host is published
    API->>SQS: event.updated
  end
  API-->>Admin: updated host event
```

The surviving event keeps one id. Future imports update that event through the rewritten
`external_refs` product id mapping.
