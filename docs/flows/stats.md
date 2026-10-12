# Stats counters

Single EAV table `stats` (`source_type`, `source_id`, `key`, `value`). The worker expands
lifetime + day/week/month/year keys and always `PUT`s via the API (never writes `stats`
itself). The API applies the body as-is (no further key expansion). Averages use
`numRatings` + `totalRatingValue` (client divides). `remove` does not clamp below zero.
`PUT` requires `STATS_WORKER_TOKEN` (Bearer or `X-Stats-Worker-Token`). Nightly reconcile
reads source tables and resets **lifetime** keys via API `value` ops.

Key examples: `numCheckins`, `numCheckins-2026-01-07`, `numCheckins-w02`,
`numCheckins-2026-m01`, `numCheckins-2026`.

```mermaid
sequenceDiagram
  participant API
  participant Queue as SQS
  participant Worker
  participant DB
  participant Client

  API->>DB: insert check_ins / ratings
  API->>Queue: checkin.created / rating.created (+ score)
  Worker->>Worker: expand bucket keys
  Worker->>API: PUT /stats/{type}/{id}<br/>[{key, add|remove|value}, ...]
  Note over Worker: never writes stats to DB directly
  API->>DB: upsert stats rows

  Note over Worker,DB: Nightly STATS_RECONCILE_MS<br/>lifetime value= from COUNT/SUM

  Client->>API: GET /stats/{type}/{id}?key=a&key=b
  API->>DB: SELECT matching keys
  API-->>Client: { items: [{ key, value }, ...] }
```
