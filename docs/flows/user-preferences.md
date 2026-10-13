# User interests & saved areas

App users (device credential → session token) persist interest tags and notification/search
areas. Mobile sends `Authorization: Bearer <sessionToken>`; web pairing can use the app-user cookie.

## Sequence

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Mobile as Mobile app
  participant API as Public API /v1
  participant DB as Postgres

  User->>Mobile: First launch / open preferences
  Mobile->>API: POST /identities (if needed)
  API->>DB: INSERT users, devices, sessions
  API-->>Mobile: deviceCredential + sessionToken

  Mobile->>API: GET /tags
  API-->>Mobile: Tag list

  User->>Mobile: Pick interests + radius
  Mobile->>API: PUT /me/interests<br/>Authorization: Bearer session
  API->>DB: Require user session<br/>REPLACE user_interests
  API-->>Mobile: { tagIds }

  Mobile->>API: POST /me/areas<br/>{ name, center, radiusM }
  Note over API: Or polygon ring<br/>(center/radius cleared)
  API->>DB: INSERT user_areas<br/>(center geography / area polygon)
  API-->>Mobile: UserArea

  Mobile->>API: GET /me/preferences
  API->>DB: SELECT interests + areas
  API-->>Mobile: Preferences
  Note over Mobile: Location menu lists Near you<br/>plus each saved area name
```

## Notes

- No background location. While the app is open, “Near you” follows foreground location updates
  (a sample when the app becomes active, then about every 100 m). Areas are saved places only.
- “How far can you go” is a slider with stops at 1 km and then every 5 km through 100 km.
  It is stored on the user in meters (`travel_distance_m`, default 25 km) and decides when a
  place is far enough to suggest saving. `PUT /me/travel-distance`. Continuing the onboarding
  area step sets it to the chosen radius (5, 25, 50, or 100 km). Skipping leaves the default.
- Circle = `center` + `radius_m`; drawn polygon = `area` geography.
- Region kind (`regions` table + suggestion UI) is a later Phase 3 slice.
- Soft cap: 20 areas (`MAX_SAVED_AREAS` in domain).
