# Delete an empty publisher

The admin publisher page lists that publisher's events, including each event id, so a staff
member can see whether the publisher is unused. Delete is offered only when the list total is 0.
The temporary publisher list shows each publisher id and offers the same delete when the event
count is 0. The all-publishers list shows each id.

```mermaid
sequenceDiagram
  participant Admin
  participant API as Admin API
  participant DB as Postgres

  Admin->>API: GET /v1/publishers/{id}/events (session cookie)
  API->>DB: publishers + events for that publisher
  API-->>Admin: items (newest start first, up to 200) and total

  alt total is 0
    Admin->>API: DELETE /v1/publishers/{id}
    API->>DB: refuse when any event row exists
    API->>DB: delete aliases, publisher follows, then the publisher
    API-->>Admin: 200 { id }
  else total is greater than 0
    Note over Admin: Delete stays hidden
    API-->>Admin: 409 publisher_has_events if DELETE is called anyway
  end
```
