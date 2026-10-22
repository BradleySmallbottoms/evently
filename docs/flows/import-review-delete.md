# Delete or wipe an event

An admin session cookie is required. Publish and reject stay `POST /v1/events/{id}/approve` and
`POST /v1/events/{id}/reject`.

On `/events/manage`, Ta bort asks for confirmation. Leaving the box unchecked cancels every selected
event and keeps the row: an event in review is rejected, and any other status is patched to
`cancelled`. Checking Ta bort permanent calls wipe. Import review still deletes or wipes only an
imported event that is `in_review`. Wipe itself removes any event and refuses when someone has
checked in, saved, rated, or been notified.

```mermaid
sequenceDiagram
  participant Admin
  participant API as Admin API
  participant DB

  alt Catalog Ta bort
    Admin->>API: POST /v1/events/{id}/reject, or PATCH status cancelled
    API->>DB: set status cancelled
  else Review delete of an imported event in review
    Admin->>API: DELETE /v1/events/{id} (session cookie)
    API->>DB: set status cancelled
    API-->>Admin: 200 { id, status: cancelled }
  end

  Note over DB: A later import leaves the cancelled row alone

  Admin->>API: POST /v1/events/{id}/wipe (session cookie)
  API->>DB: refuse when check-ins, ratings, saves, coming, or notifications exist
  API->>DB: insert import_suppressions (source_id, external_id)
  API->>DB: delete events row (cascades refs, tags, images, pushes)
  API-->>Admin: 200 { id }

  Note over DB: A later import of the same source id is skipped. Wipe removes any event, not only a review import
```
