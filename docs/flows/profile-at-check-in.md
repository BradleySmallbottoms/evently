# Profile prompt at first check-in

After a successful check-in, mobile loads `GET /v1/me/profile`. If `profileChosen` is false,
it offers named vs anonymous (optional recovery email). Choice is persisted with
`profile_chosen_at` so the prompt does not repeat.

```mermaid
sequenceDiagram
  participant Mobile
  participant API
  participant Domain
  participant DB

  Mobile->>API: POST check-in (geo or code)
  API-->>Mobile: 201 CheckIn
  Mobile->>API: GET /v1/me/profile (Bearer)
  API->>DB: users row
  API-->>Mobile: { profileChosen: false, … }
  Mobile->>Mobile: show profile sheet
  alt named
    Mobile->>API: PUT /v1/me/profile<br/>{ choice: named, displayName, recoveryEmail? }
    API->>Domain: resolveProfileChoice
    API->>DB: set display_name, is_public, profile_chosen_at, recovery_email
  else anonymous
    Mobile->>API: PUT /v1/me/profile<br/>{ choice: anonymous, recoveryEmail? }
    API->>DB: clear name, is_public=false, set profile_chosen_at
  end
  API-->>Mobile: { profileChosen: true, … }
```

Recovery email verification (one-time code → fresh device credential) remains a later slice;
email is never shown on public surfaces.
