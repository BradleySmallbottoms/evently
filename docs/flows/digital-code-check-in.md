# Rotating digital code / venue QR check-in

Publisher starts a live session (sets `digital_codes.revealed_at`). The API derives a 6-character
TOTP-style code from a per-event HMAC secret (60s slots, previous slot accepted). Attendees post
the current code; the secret never leaves the server.

```mermaid
sequenceDiagram
  participant Pub as Publisher web
  participant API
  participant Domain
  participant DB
  participant Mobile
  participant Queue as SQS

  Pub->>API: POST /v1/manage/events/{id}/digital-code/start (cookie)
  API->>DB: upsert digital_codes secret; set revealed_at
  API->>Domain: deriveDigitalCode(secret, slot)
  API-->>Pub: { code, qrPayload, slotEndsAt }

  loop every ~60s
    Pub->>API: GET /v1/manage/events/{id}/digital-code
    API-->>Pub: current code + localevents://check-in/{id}?c=
  end

  Mobile->>API: GET /v1/events/{id}/check-in (Bearer)
  API-->>Mobile: { open, codeActive: true, … }

  Mobile->>API: POST /v1/events/{id}/check-ins/code<br/>{ code }
  API->>Domain: validateCodeCheckIn (revealed, window, code)
  alt rejected
    API-->>Mobile: 400/409 error.code
  else ok
    API->>DB: insert check_ins method=code
    API->>Queue: { type: checkin.created }
    API-->>Mobile: 201 CheckIn
  end
```

Physical events can still use geofence check-in; code is the indoor / digital fallback once started.
