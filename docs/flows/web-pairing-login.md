# Web sign-in with app pairing code

App user generates an 8-character code on the phone; the browser exchanges it for an httpOnly
session cookie. Codes are single-use, 5-minute TTL, purpose `web_login`.

## Sequence

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Mobile as Mobile app
  participant API as Public API /v1
  participant DB as Postgres
  participant Web as Web /login-with-code

  User->>Mobile: Open pairing sheet → Web tab
  Mobile->>Mobile: loadStoredIdentity()
  Mobile->>API: POST /pairing/code<br/>{ deviceCredential }
  API->>DB: Lookup devices by credential_hash
  API->>DB: INSERT web_login_codes<br/>(purpose=web_login, status=pending, user_id, expires_at)
  API-->>Mobile: { code, expiresAt }
  Mobile-->>User: Show code

  User->>Web: Enter code (or ?code= deep link)
  Note over Web: Client form — must not SSR-exchange<br/>(Set-Cookie would be lost / code burned)
  Web->>API: POST /pairing/login<br/>{ code } (credentials: include)
  API->>DB: SELECT pending web_login code<br/>(hash, purpose, not expired)
  API->>DB: UPDATE code status=used
  API->>DB: INSERT sessions<br/>(subject_type=user, client=web)
  API-->>Web: Set-Cookie le_user_session<br/>+ { userId, expiresAt }

  Web->>API: GET /pairing/me (cookie)
  API->>DB: Resolve session token_hash
  API-->>Web: { userId }
```

## Need to know

- Exchange **only from the browser** (`credentials: 'include'`). Server-side `fetch` to the API
  consumes the code but never sets the user’s cookie.
- CORS must allow the web origin (`http://localhost:13100` in dev) with `credentials: true`.
- Reusing a code returns `401 invalid_pairing_code`.
