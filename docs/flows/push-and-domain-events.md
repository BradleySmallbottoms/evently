# Push token registration + push message approval

Mobile registers an Expo push token on the device row. Publishing (or submitting) an event
creates a **`push_messages` draft**. Trusted publishers auto-approve; others wait for admin
approval. An optional `send_at` schedules delivery. The worker polls due approved messages,
resolves audience at send time, writes inbox rows, and sends a **silent/data Expo push**.
Per-user aggregation defers when another matching message is due within 10 minutes, then
combines copy (“And N more…”). Quiet hours and the daily OS-notification cap stay on the
client. The in-app list is API-backed.

```mermaid
sequenceDiagram
  participant Mobile
  participant API
  participant Admin
  participant DB
  participant Worker

  Mobile->>API: PUT /v1/me/push-token
  API->>DB: update devices.expo_push_token

  Note over API,DB: Publish / submit event
  API->>DB: events.status + insert/update push_messages
  Note over DB: pending or approved (trusted)

  Admin->>API: PATCH/approve push message
  API->>DB: status = approved, optional send_at

  loop Every ~30s
    Worker->>DB: claim due approved messages
    Worker->>DB: match users; defer if another due ≤10m
    Worker->>DB: insert notifications inbox rows
    Worker->>Worker: Silent Expo push (data + badge)
  end

  Note over Mobile: Cap + quiet hours on device, including in the foreground
  Mobile->>Mobile: Local OS notification
  Note over Mobile: Tap with an event id opens that event
  Note over Mobile: Becoming active clears the app icon badge
  Mobile->>API: GET /v1/me/notifications
```

## Draft lifecycle

| Trigger | Behavior |
| --- | --- |
| Submit / publish event | Create open draft (or update if one is open). Auto-approve when publisher is trusted. |
| Edit event before send | Refresh default copy unless `copy_edited`; untrusted edits re-pend approval. |
| Edit event after send | Open draft unchanged; publisher may `POST` a new draft (“Notify again”). |
| Admin approve / reject | `approved` or `rejected`; schedule editable. |
| Admin event notification | `POST /push-messages/event` creates an approved event draft for a published event. Audience is `area` (saved notify area covers the point) or `area_and_tag` (area plus a shared interest). Followers are not included. Refused while an open draft exists. Optional `send_at` and copy. |
| Admin broadcast | `POST /push-messages/broadcast` creates an approved row (`everyone` or `tag_interest`); optional `send_at`. |
| Event cancelled | Cancel open draft; cancel undelivered deliveries. |
| Worker send | Inbox + silent push; status `sent`. Broadcast inbox rows have `event_id` null and reason `broadcast`. |
| Sent history | Admin `GET /events/{id}/sent-notifications` and publisher `GET /manage/events/{id}/sent-notifications` list messages in `sending` or `sent` for that event, with a distinct inbox-recipient count. Open drafts stay on the draft endpoints. |

## Aggregation (per user)

When delivering message **M** to user **U**, if another approved message matching **U** has
`send_at` in `[now, now+10m]`, mark **M** deferred for **U** and wait. At the later message,
re-check the window; if clear, deliver the bundle: one inbox row per message, one Expo push
with the earliest copy plus “And N more…”.

## Quiet hours and daily cap (client-only)

- Defaults: enabled, 22:00–08:00 in the user’s timezone (`Europe/Stockholm` at launch).
- Backend always stores the inbox row at send time and attempts a silent Expo push (when a
  token exists).
- Mobile may post a local OS notification only outside quiet hours and under the 5/day cap.
  That includes while the app is in the foreground.
- That local banner is posted from the foreground listener, or from a headless task
  (`expo-task-manager`) when the app is backgrounded or terminated, because a data-only
  push does not show a system banner. iOS delivers the task only when `UIBackgroundModes` includes
  `remote-notification` (`enableBackgroundRemoteNotifications` on the expo-notifications plugin).
  That plist value needs a new native build.
- Tapping a notification whose payload has an event id opens that event. Broadcasts have no
  event id and stay on the current screen.
- The app icon badge from the silent push clears when the app becomes active.

## Retention

- Worker hard-deletes inbox rows with `sent_at` older than **90 days** (batched) when handling
  domain events / push ticks.

## Auth notes

- Session alone is not enough for push-token registration: the body includes `deviceCredential`.
- Unverified publishers’ events stay `awaiting_verification`; the draft may exist but the
  worker only sends when the event is `published`.
- `event.published` still drives publisher stats; fan-out is driven by approved `push_messages`.
