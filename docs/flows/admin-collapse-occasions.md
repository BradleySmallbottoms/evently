# Collapse occasions in admin

Staff open an event that already has several `meta.occasions` rows, or an `meta.occasionGroupId`.
The admin session cookie is required. The Tillfällen tab lists the stored occasions, then every
event in the group. The open event is shown in gray and cannot be checked.

```mermaid
sequenceDiagram
  participant Admin
  participant API as Admin API
  participant DB
  participant SQS
  Admin->>API: GET /v1/events/{id}
  API->>DB: events
  API-->>Admin: detail, including meta.occasions and meta.occasionGroupId
  Admin->>API: GET /v1/events/{id}/occasion-group
  API->>DB: events where meta.occasionGroupId matches
  API-->>Admin: events in the group that are not cancelled or ended, including this one
  Admin->>API: POST /v1/events/{id}/collapse
  Note over API: Body is the checked event ids. They must share this event's group.
  API->>DB: set this event's start, end, meta.collapsed, and meta.occasions
  API->>DB: cancel the checked events and clear their occasionGroupId
  API->>DB: cancel their open reminders, write audit_log
  alt this event is published
    API->>SQS: event.updated
  end
  API-->>Admin: updated event
```

The event start is the earliest occasion start. The end is the latest occasion end. A later import
of a cancelled source id leaves that row cancelled.
