# Delete an import from review

An admin session cookie is required. Publish and reject stay `POST /v1/events/{id}/approve` and
`POST /v1/events/{id}/reject`. Delete is only for events still `in_review`.

```mermaid
sequenceDiagram
  participant Admin
  participant API as Admin API
  participant DB

  Admin->>API: DELETE /v1/events/{id} (session cookie)
  API->>DB: read external_refs for the event
  API->>DB: insert import_suppressions (source_id, external_id)
  API->>DB: delete events row (cascades refs, tags, images, pushes)
  API-->>Admin: 200 { id }

  Note over DB: A later import of the same source id is skipped
```
