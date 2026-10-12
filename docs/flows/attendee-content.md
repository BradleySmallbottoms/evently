# Attendee content (signed URLs)

Check-in is off until an admin enables it. The publisher then adds extra text and links on the
event, plus maps/schedules/info/files under `/manage/events/{id}/content`. Attendees
`GET /v1/events/{id}/content` — public rows always; attendee text, attendee links, and `attendees`
rows only after check-in. File items get a short-lived URL from an injectable signer (memory in
tests/dev; CloudFront/S3 in prod). Mobile caches checked-in payloads in SecureStore for offline
venue use.

```mermaid
sequenceDiagram
  participant Pub as Publisher web
  participant API
  participant Domain
  participant DB
  participant Signer
  participant Mobile

  Pub->>API: POST /v1/manage/events/{id}/content (cookie)
  API->>DB: insert event_content
  API-->>Pub: EventContentItem (+ signed url if s3_key)

  Mobile->>API: GET /v1/events/{id}/content (Bearer optional)
  API->>DB: load published event + content rows
  API->>DB: check_ins for user?
  API->>Domain: canViewEventContent(visibility, hasCheckIn)
  API->>Signer: sign(s3_key) for file items
  API-->>Mobile: { items, checkedIn }
  Mobile->>Mobile: SecureStore cache when checkedIn
```
