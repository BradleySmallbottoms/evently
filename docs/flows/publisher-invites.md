# Publisher profiles & member invites

Owners manage publisher name/slug/type and invite owner/editor members by email. Invite tokens are
hashed at rest (`publisher_invites.token_hash`), TTL 7 days. Outside production the create response
may include `inviteToken` (same `INCLUDE_VERIFICATION_TOKEN` / `includeVerificationToken` flag as
email verification) so local/dev can accept without SES.

## Sequence

```mermaid
sequenceDiagram
  autonumber
  actor Owner
  actor Invitee
  participant Web as Web (publisher workspace)
  participant API as Public API /v1
  participant DB as Postgres

  Owner->>Web: Open /publisher/{id}/settings
  Web->>API: GET /publishers/{id}<br/>(publisher session cookie)
  API->>DB: Require membership
  API-->>Web: Profile + role

  Owner->>Web: PATCH profile (name/slug/type)
  Web->>API: PATCH /publishers/{id}
  Note over API: Owner only<br/>(canManagePublisherOrg)
  API->>DB: UPDATE publishers
  API-->>Web: Updated profile

  Owner->>Web: Invite editor@example.com
  Web->>API: POST /publishers/{id}/invites<br/>{ email, role }
  API->>DB: Check member limit, pending invite,<br/>existing membership
  API->>DB: INSERT publisher_invites<br/>(token_hash, expires_at)
  API-->>Web: { id, expiresAt, inviteToken? }

  Invitee->>Web: Register + verify + login<br/>as invited email
  Invitee->>Web: /publisher/invites/accept
  Web->>API: POST /publishers/invites/accept<br/>{ token }
  API->>DB: Lookup invite by token_hash<br/>Match session email to invite.email
  API->>DB: SET accepted_at; INSERT publisher_members
  API-->>Web: { publisherId, role }
```

## Notes

- Editors can list members and read the profile but cannot PATCH the profile or create/list invites.
- Accepting requires a **publisher session** whose account email matches the invite (case-insensitive).
- Duplicate pending invites for the same publisher+email → `invite_pending` (409).
