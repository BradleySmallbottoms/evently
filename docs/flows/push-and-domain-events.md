# Push token registration + domain events

Mobile registers an Expo push token on the device row. Publishing a verified event enqueues
`event.published` for the worker (SQS in AWS; ElasticMQ locally via `DOMAIN_EVENTS_QUEUE_URL`;
in-process memory when the queue URL is unset). The worker matches nearby users (areas ∩
interests), enforces the daily inbox cap, writes a `notifications` inbox row, then either sends
an immediate Expo push or defers until after quiet hours.

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
  Worker->>DB: PostGIS match + claim notifications inbox row
  alt Outside quiet hours
    Worker->>Worker: Expo Push (per event)
  else Inside quiet hours
    Note over Worker,DB: push_state = pending; no Expo yet
  end
  Worker->>Queue: DeleteMessage

  Note over Mobile,API: Any time (incl. quiet hours)
  Mobile->>API: GET /v1/me/notifications
  API->>DB: list inbox rows for user
  API-->>Mobile: items for notifications window

  Note over Worker,DB: After quiet window ends (scheduler / wake)
  Worker->>DB: pending rows for user
  Worker->>Worker: one aggregate Expo push
  Worker->>DB: mark pending → aggregated
```

## Quiet hours

- Defaults: enabled, 22:00–08:00 in the user’s timezone (`Europe/Stockholm` at launch). Editable in
  preferences (planned).
- During the window: still insert the inbox row so the mobile notifications window can show it if
  the user opens the app. Do **not** send an immediate Expo push.
- When the window ends: send **one** aggregate Expo summarizing deferred pending items; mark those
  rows `aggregated`. Individual event pages remain reachable from the inbox list.
- Daily cap (5/day) counts matches accepted into the inbox, not the aggregate Expo itself.

## Auth notes

- Session alone is not enough: the body includes `deviceCredential` so the token lands on the
  correct device row (a user can have multiple devices).
- Unverified publishers publish as `awaiting_verification`; `shouldEnqueueNotifications` skips
  those. Admin `POST /v1/publishers/{id}/verify` releases upcoming events and enqueues each one
  that becomes `published`.
- Enqueue is best-effort after the DB write so a transient SQS failure does not roll back publish
  (outbox comes later).
