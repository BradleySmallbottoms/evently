# Delete or wipe an event

An admin session cookie is required. Publish and reject stay `POST /v1/events/{id}/approve` and
`POST /v1/events/{id}/reject`.

On `/events/manage`, Ta bort asks for confirmation. Leaving the box unchecked sets the status to
`deleted` and keeps the row, so the event leaves every list. A later import finds that source id,
sees `deleted`, and skips it. Checking Ta bort permanent calls wipe. Import review delete does the
same status change for an imported event that is `in_review`. Wipe itself removes any event and
refuses when someone has checked in, saved, rated, or been notified.

```mermaid
sequenceDiagram
  participant Admin
  participant API as Admin API
  participant DB

  alt Catalog Ta bort
    Admin->>API: PATCH status deleted
    API->>DB: set status deleted
  else Review delete of an imported event in review
    Admin->>API: DELETE /v1/events/{id} (session cookie)
    API->>DB: set status deleted
    API-->>Admin: 200 { id, status: deleted }
  end

  Note over DB: The row stays off every list. A later import sees deleted and skips that source id

  Admin->>API: POST /v1/events/{id}/wipe (session cookie)
  API->>DB: refuse when check-ins, ratings, saves, coming, or notifications exist
  API->>DB: insert import_suppressions (source_id, external_id)
  API->>DB: delete events row (cascades refs, tags, images, pushes)
  API-->>Admin: 200 { id }

  Note over DB: A later import of the same source id is skipped. Wipe removes any event, not only a review import
```
