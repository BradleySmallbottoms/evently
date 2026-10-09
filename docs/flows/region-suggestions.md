# Region suggestions

When the app is used somewhere new, the device may offer to save that place as a region
subscription. Location stays on-device until the user accepts. Declines are stored only on the
device.

## Sequence

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Mobile as Mobile app
  participant API as Public API /v1
  participant DB as Postgres

  User->>Mobile: Foreground / open screens
  Note over Mobile: shouldSuggestRegion()<br/>(domain thresholds)
  Mobile->>Mobile: Coarse GPS (permission already granted)
  alt Far from saved areas + active session
    Mobile->>API: GET /regions/lookup?lat&lng
    API->>DB: ST_Covers(boundary, point)<br/>prefer municipality
    API-->>Mobile: { region } or null
    Mobile-->>User: Save {{name}}?
    alt Save and notify / Save quiet
      Mobile->>API: POST /me/areas<br/>{ regionId } or 15 km circle fallback
      API->>DB: INSERT user_areas<br/>kind=region, copy boundary
      API-->>Mobile: UserArea
    else Not now / Never
      Mobile->>Mobile: Persist decline locally
    end
  end
```

## Notes

- Seed fixtures: Söderhamn kommun `2180` + Gävleborg län `21` (simplified multipolygons).
- Official SCB/Lantmäteriet boundaries can replace fixtures later without API changes.
- Fallback when lookup misses: circle with `REGION_SUGGESTION.fallbackRadiusM` (15 km).
