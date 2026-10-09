# Physical geofence check-in

Mobile requests a high-accuracy location and posts it to the API. Domain rules decide whether
the check-in is accepted; a successful write enqueues `checkin.created` for the worker (stats later).

```mermaid
sequenceDiagram
  participant Mobile
  participant API
  participant Domain
  participant DB
  participant Queue as SQS

  Mobile->>API: GET /v1/events/{id}/check-in (Bearer)
  API->>DB: load published event + existing check_ins row
  API-->>Mobile: { checkedIn, open, opensAt, closesAt }

  Mobile->>Mobile: Location.getCurrentPositionAsync (High)
  Mobile->>API: POST /v1/events/{id}/check-ins<br/>{ location, accuracyM }
  API->>Domain: validateGeoCheckIn (window, accuracy ≤ 100 m, geofence)
  alt rejected
    API-->>Mobile: 400/409 with stable error.code
  else ok
    API->>DB: insert check_ins (unique user+event)
    API->>Queue: { type: checkin.created, eventId, userId }
    API-->>Mobile: 201 CheckIn
  end
```

Venue QR / digital codes are a later Phase 4 slice.
