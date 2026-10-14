# Rejected device identity

The mobile app proves its stored device credential on launch and whenever it returns to the
foreground. A deleted user, a revoked device, or a banned user cannot keep using that install.
The person confirms an alert, then the app deletes on-device stores and runs onboarding again.

A network failure is not a rejection: the stored credential stays, and the app keeps working
offline with the session it already has.

## Sequence

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Mobile
  participant API as Public API /v1
  participant DB as Postgres

  Note over Mobile: Cold start, or background → active
  Mobile->>Mobile: Read device credential from secure storage
  alt No credential stored
    Mobile->>User: Onboarding
    Mobile->>API: POST /identities
  else Credential stored
    Mobile->>API: POST /sessions<br/>{ deviceCredential }
    API->>DB: Lookup devices by credential_hash<br/>where revoked_at is null
    API->>DB: Read users.banned_at
    alt Device missing, revoked, or user banned
      API-->>Mobile: 401 invalid_credentials<br/>or 403 user_banned
      Mobile->>User: Alert — start over
      User->>Mobile: Confirm
      Mobile->>Mobile: Delete secure-store keys<br/>and other local app stores
      Mobile->>User: Onboarding from the start
    else Credential still active
      API->>DB: INSERT sessions, touch last_seen_at
      API-->>Mobile: { userId, sessionToken, expiresAt }
      Mobile->>Mobile: Replace stored session
    else API unreachable
      API--xMobile: Network error
      Note over Mobile: Keep the stored identity
    end
  end
```

## Notes

- Session exchange is the check. `requireUserSession` on an existing token would still succeed
  after a device revoke until that token expired, and would miss a deleted device.
- Confirmation wipes the known secure-store keys (identity, onboarding, prompts, home filters)
  via `clearLocalAppData`, then shows the onboarding carousel. The next continue creates a new
  anonymous identity.
- The same rejection during a later session refresh (token inside five minutes of expiry) opens
  the same alert. It does not silently create a replacement identity.
