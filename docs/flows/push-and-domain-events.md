# Push token registration + domain events

Mobile registers an Expo push token on the device row. Publishing a verified event enqueues
`event.published` for the worker (SQS in AWS; ElasticMQ locally via `DOMAIN_EVENTS_QUEUE_URL`;
in-process memory when the queue URL is unset). The worker matches nearby users (areas ∩
interests), applies quiet hours and a daily cap, then sends Expo push and records a
`notifications` row.

```mermaid
sequenceDiagram
  participant Mobile
  participant API
  participant DB
  participant Queue as SQS / ElasticMQ / memory
  participant Worker

  Mobile->>API: PUT /v1/me/push-token<br/>Bearer session + deviceCredential + expoPushToken
  API->>DB: update devices.expo_push_token<br/>(credential must belong to session user)
  API-->>Mobile: { ok: true }

  Note over API,Worker: Later — verified publish, or admin verifies publisher
  API->>DB: events.status = published
  API->>Queue: { type: event.published, eventId } (best-effort after write)
  Worker->>Queue: long-poll ReceiveMessage
  Worker->>DB: PostGIS match + claim notifications
  Worker->>Worker: Expo Push API (batches of 100)
  Worker->>Queue: DeleteMessage
```

## Auth notes

- Session alone is not enough: the body includes `deviceCredential` so the token lands on the
  correct device row (a user can have multiple devices).
- Unverified publishers publish as `awaiting_verification`; `shouldEnqueueNotifications` skips
  those. Admin `POST /v1/publishers/{id}/verify` releases upcoming events and enqueues each one
  that becomes `published`.
- Enqueue is best-effort after the DB write so a transient SQS failure does not roll back publish
  (outbox comes later).
