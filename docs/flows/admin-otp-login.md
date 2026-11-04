# Admin email one-time-code login

An admin can sign in with a 6-digit code instead of a password and authenticator. Password plus
TOTP stays available. The code is single-use, lasts 10 minutes, and allows five wrong guesses.
One email can request five codes per 15 minutes. Unknown emails get the same `code_sent` body
and no code.

The code is stored as a peppered hash on `email_verification_tokens`
(`purpose=admin_login_otp`). Without `ADMIN_OTP_PEPPER` the pepper is random for the process, so a
restart invalidates outstanding codes and a database dump is not a 6-digit rainbow table. Confirm
marks the row used only while it is still unused, then inserts the session in the same transaction.
When `RESEND_API_KEY` and `RESEND_FROM` are both set, the admin API emails the code through Resend
and the response omits it. The from address must use a domain verified in Resend. Outside
production, with Resend unset, the response includes the raw code. `ADMIN_INCLUDE_LOGIN_OTP=true`
includes it in production too. Leave that unset on a public host.

## Sequence

```mermaid
sequenceDiagram
  actor Admin
  participant UI as Admin console
  participant API as Admin API /v1
  participant DB as Postgres
  participant Resend

  Admin->>UI: Sign in with a code
  UI->>API: POST /admin/login/otp { email }
  API->>DB: Retire unused admin_login_otp rows<br/>INSERT email_verification_tokens (hash, 10 min)
  API->>Resend: Send the code when RESEND_API_KEY and RESEND_FROM are set
  API-->>UI: { status: code_sent, code? }
  Note over UI: Outside production the response includes the code.<br/>Test runs as production, so it omits the code and emails it.
  Admin->>UI: Enter 6 digits
  UI->>API: POST /admin/login/otp/confirm { email, code }
  API->>DB: Match hash, set used_at,<br/>INSERT sessions (subject_type=admin)
  API-->>UI: Set-Cookie le_admin_session
  UI->>UI: Open /publishers
```
