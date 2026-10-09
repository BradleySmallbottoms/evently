# Flow charts

End-to-end diagrams for major features that span **client → API → DB** (and sometimes workers).
Use these when onboarding, debugging, or reviewing a flow.

## When to add one

After every **new major feature** with non-trivial client/API/DB sequencing, add a Mermaid
flowchart here and link it from the root [README.md](../../README.md) Need-to-knows section.

Name files `kebab-case.md`. Prefer sequence or flowchart diagrams that name:

- Which client (mobile / web / admin)
- HTTP method + path (versioned as called, e.g. `/v1/…`)
- Auth material (device credential, cookie, session)
- Tables touched and important status transitions

## Index

| Feature | Diagram |
| ------- | ------- |
| Web sign-in with app pairing code | [web-pairing-login.md](./web-pairing-login.md) |
| Device linking (new phone → old phone confirms) | [device-linking.md](./device-linking.md) |
| Publisher profiles & member invites | [publisher-invites.md](./publisher-invites.md) |
| User interests & saved areas | [user-preferences.md](./user-preferences.md) |
| Region suggestions | [region-suggestions.md](./region-suggestions.md) |
| Push token, nearby match, subscriptions (SQS → worker) | [push-and-domain-events.md](./push-and-domain-events.md) |
| Physical geofence check-in | [geo-check-in.md](./geo-check-in.md) |
| Rotating digital code / venue QR check-in | [digital-code-check-in.md](./digital-code-check-in.md) |
| Profile prompt at first check-in | [profile-at-check-in.md](./profile-at-check-in.md) |
| Attendee content (signed URLs) | [attendee-content.md](./attendee-content.md) |
