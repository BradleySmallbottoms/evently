# For you

Home **För dig** recommends upcoming events from what the user has already done. There is no time
window: the newest interactions count, however old they are.

```mermaid
sequenceDiagram
  participant Mobile
  participant API
  participant DB
  Mobile->>API: GET /v1/me/saved-events
  API->>DB: saved_events, newest first
  Mobile->>API: GET /v1/me/coming-events
  API->>DB: coming_events, newest first
  Mobile->>API: GET /v1/me/check-ins
  API->>DB: check_ins, newest first, with event tags
  Mobile->>API: GET /v1/me/subscriptions
  API->>DB: subscriptions
  Mobile->>API: GET /v1/events?lat&lng&radiusM&tagIds
  API->>DB: published events in the selected area
  Note over Mobile: Keep events that share a tag with the last 20 of each interaction,<br/>or whose publisher is followed. Drop featured events and events already acted on.<br/>If home tags are selected, keep only those tags.
```

The upcoming list on home is the full catalog, so a For you card may appear there too.
