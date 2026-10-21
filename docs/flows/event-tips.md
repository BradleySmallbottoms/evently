# Event tips

A person can tip the app about an event that is missing. The tip stays private until an admin
publishes the event the scan creates. Poster reading uses Anthropic. The later event scan is the
same import scan as every other source.

Layout reference: [event-tip-ui.png](../event-tip-ui.png) and
[event-tip-status-ui.png](../event-tip-status-ui.png).

```mermaid
sequenceDiagram
  participant App as Mobile
  participant API as Public API
  participant Model as Anthropic
  participant DB as Postgres
  participant Scan as Event scan
  participant Worker as Worker

  App->>API: POST /v1/me/tips (Bearer session)
  API->>DB: insert event_tips
  alt Photo
    App->>API: POST /v1/me/tips/{id}/images
    API-->>App: phase scanning
    API->>Model: read the poster
    Model-->>API: title, time, place, price
    API->>DB: save extraction, create pending_scan event
  else Text
    App->>API: POST /v1/me/tips/{id}/text
    API->>Model: read the text
    API-->>App: confirm card
    App->>API: POST /v1/me/tips/{id}/confirm
    opt Follow-up still empty
      App->>API: POST confirm with submitFollowUp
    end
    API->>DB: create pending_scan event on source user-tips
  end
  Scan->>DB: claim pending_scan, set in_review or published
  Scan->>Worker: tip.scanned
  Worker->>DB: inbox row reason tip
  Worker->>App: visible Expo push kind tip_scan
  App->>API: GET /v1/me/tips/{id}
  App->>App: Ditt tips when published, otherwise Tipsets status
```

- Auth is the device session. A tip is readable only by that user.
- `user-tips` is trust `review` and stays disabled, so the scan lands the event in `in_review`
  unless that source is later switched to `auto_publish` and the publisher is already published.
- The push ignores quiet hours and the daily cap. The copy says the event was added only when
  the scan published it. While the app is open the banner is hidden and the tip screen opens.
  A tap from the lock screen opens that same screen.
- Deleting the user removes `event_tips`, `tip_messages`, and `tip_images`. The event stays.
