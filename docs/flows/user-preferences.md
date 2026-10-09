# User interests & saved areas

App users (device credential → session token) persist interest categories and notification/search
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

  Mobile->>API: GET /categories
  API-->>Mobile: Category list

  User->>Mobile: Pick interests + radius
  Mobile->>API: PUT /me/interests<br/>Authorization: Bearer session
  API->>DB: Require user session<br/>REPLACE user_interests
  API-->>Mobile: { categoryIds }

  Mobile->>API: POST /me/areas<br/>{ name, center, radiusM }
  Note over API: Or polygon ring<br/>(center/radius cleared)
  API->>DB: INSERT user_areas<br/>(center geography / area polygon)
  API-->>Mobile: UserArea

  Mobile->>API: GET /me/preferences
  API->>DB: SELECT interests + areas
  API-->>Mobile: Preferences
  Note over Mobile: Home feed uses primary<br/>active circle area when set
```

## Notes

- No background location; areas are saved places only.
- Circle = `center` + `radius_m`; drawn polygon = `area` geography.
- Region kind (`regions` table + suggestion UI) is a later Phase 3 slice.
- Soft cap: 20 areas (`MAX_SAVED_AREAS` in domain).
