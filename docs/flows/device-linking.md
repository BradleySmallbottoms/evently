# Device linking

Recovery when the user gets a new phone: the **new** phone shows a pairing code; the **old**
(already trusted) phone confirms. Only the device that created the code is remapped onto the
confirming user. Codes use purpose `device_link` on `web_login_codes` (same alphabet/TTL as web
pairing).

## Sequence

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant NewPhone as New phone (mobile)
  participant OldPhone as Old phone (mobile)
  participant API as Public API /v1
  participant DB as Postgres

  User->>NewPhone: First launch
  NewPhone->>API: POST /identities<br/>{ platform, locale }
  API->>DB: INSERT users, devices, sessions
  API-->>NewPhone: { userId: U_new, deviceId: D_new,<br/>deviceCredential, sessionToken }

  User->>NewPhone: Pairing sheet → Link phone → Generate
  NewPhone->>API: POST /pairing/device-link/code<br/>{ deviceCredential }
  API->>DB: Lookup device D_new by credential_hash
  API->>DB: INSERT web_login_codes<br/>(purpose=device_link, status=pending,<br/>user_id=U_new, device_id=D_new)
  API-->>NewPhone: { code, expiresAt }
  NewPhone-->>User: Show code

  User->>OldPhone: Pairing sheet → Link phone → Enter code → Confirm
  OldPhone->>API: POST /pairing/device-link/confirm<br/>{ deviceCredential (old), code }
  API->>DB: Lookup confirming device → U_old
  API->>DB: SELECT pending device_link code
  Note over API: Reject if U_new === U_old<br/>(device_link_same_user)
  API->>DB: UPDATE code SET status=used<br/>WHERE id AND status=pending
  API->>DB: UPDATE devices SET user_id=U_old<br/>WHERE id=D_new
  API->>DB: Revoke sessions for subject U_new
  API-->>OldPhone: { userId: U_old }
  OldPhone->>API: POST /sessions (refresh local identity)
  API-->>OldPhone: { userId: U_old, sessionToken, … }

  User->>NewPhone: “I’ve confirmed — refresh”
  NewPhone->>API: POST /sessions<br/>{ deviceCredential (new) }
  API->>DB: Lookup D_new → now user_id=U_old
  API->>DB: INSERT new app session for U_old
  API-->>NewPhone: { userId: U_old, sessionToken, … }
  NewPhone->>NewPhone: Persist updated userId + session
```

## Need to know

- Only **`device_id` on the code** is remapped — not every device belonging to `U_new`.
- Code consume is conditional (`status = pending`) so concurrent confirms don’t double-succeed.
- After confirm, the new phone must call **`POST /sessions`** (or the in-app refresh control);
  its old app sessions for `U_new` were revoked.
- Same threat model as web pairing: a stolen live code can be confirmed by any valid device
  credential; keep TTL short (5 minutes) and rate-limit in production.
