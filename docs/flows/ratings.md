# Ratings (“How was it?”)

Checked-in attendees may rate once from `ends_at` until 14 days after. Public surfaces see
aggregate average + count only. Comments require a named public profile and are returned only on
publisher manage.

```mermaid
sequenceDiagram
  participant Mobile
  participant API
  participant Domain
  participant DB
  participant Queue as SQS

  Mobile->>API: GET /v1/events/{id}/rating (Bearer optional)
  API->>DB: event + check_ins + ratings
  API->>Domain: canRate
  API-->>Mobile: { canRate, hasRated, aggregate }

  Mobile->>API: POST /v1/events/{id}/ratings<br/>{ score, comment? }
  API->>Domain: canRate + canComment
  alt ineligible / comment not allowed
    API-->>Mobile: 400/409
  else ok
    API->>DB: insert ratings (unique user+event)
    API->>Queue: { type: rating.created }
    API-->>Mobile: 201 Rating (comment null)
  end

  participant Pub as Publisher web
  Pub->>API: GET /v1/manage/events/{id}/ratings
  API-->>Pub: items with comment + displayName
```
