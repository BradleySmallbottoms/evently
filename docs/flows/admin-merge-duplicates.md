# Hide a possible duplicate in admin

Staff open an event and see other events that look like it, with those events' occasions. The admin
session cookie is required. The Tillfällen tab lists this event's rows from `event_occasions`, then
the possible duplicates.

Hiding a duplicate does not move occasions. The checked event becomes `deleted`, so it leaves event
lists, and `meta.duplicateOf` points at the open event. A later import of that source id skips it.
The open event stores the hidden events on `meta.mergedDuplicates`. It drops `meta.possibleDuplicate`
when that note pointed at one of the hidden events, so the duplicate warning goes away. Public
responses omit both fields.

```mermaid
sequenceDiagram
  participant Admin
  participant API as Admin API
  participant DB
  Admin->>API: GET /v1/events/{id}/possible-duplicates
  API->>DB: events flagged either way, plus event_occasions
  API-->>Admin: duplicates and their occasions
  Admin->>API: POST /v1/events/{id}/merge-duplicates
  Note over API: Body is the checked event ids. Occasions stay.
  API->>DB: set checked events deleted and meta.duplicateOf
  API->>DB: record meta.mergedDuplicates and drop the warning
  API->>DB: cancel open reminders on the hidden events
  API-->>Admin: updated open event
```
