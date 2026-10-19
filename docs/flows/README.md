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

| Feature                                                | Diagram                                                  |
| ------------------------------------------------------ | -------------------------------------------------------- |
| Rejected device identity (reset + onboarding)          | [identity-reset.md](./identity-reset.md)                 |
| Web sign-in with app pairing code                      | [web-pairing-login.md](./web-pairing-login.md)           |
| Device linking (new phone → old phone confirms)        | [device-linking.md](./device-linking.md)                 |
| Publisher profiles & member invites                    | [publisher-invites.md](./publisher-invites.md)           |
| Saved areas and area tags                              | [user-preferences.md](./user-preferences.md)             |
| Region suggestions                                     | [region-suggestions.md](./region-suggestions.md)         |
| Push token, nearby match, subscriptions (SQS → worker) | [push-and-domain-events.md](./push-and-domain-events.md) |
| Physical geofence check-in                             | [geo-check-in.md](./geo-check-in.md)                     |
| For you                                                | [for-you.md](./for-you.md)                               |
| Rotating digital code / venue QR check-in              | [digital-code-check-in.md](./digital-code-check-in.md)   |
| Profile prompt at first check-in                       | [profile-at-check-in.md](./profile-at-check-in.md)       |
| Attendee content (signed URLs)                         | [attendee-content.md](./attendee-content.md)             |
| Ratings (“How was it?”)                                | [ratings.md](./ratings.md)                               |
| Stats counters                                         | [stats.md](./stats.md)                                   |
| Visit Söderhamn import                                 | [visit-soderhamn.md](./visit-soderhamn.md)               |
| Import scan                                            | [event-scan.md](./event-scan.md)                         |
| Publisher lookup                                       | [publisher-scan.md](./publisher-scan.md)                 |
| Glada Hudik import                                     | [glada-hudik.md](./glada-hudik.md)                       |
| Destination Hälsingland import                         | [destination-halsingland.md](./destination-halsingland.md) |
| Saved events and custom lists                          | [saved-events.md](./saved-events.md)                     |
| I'm coming and popular events                          | [event-coming.md](./event-coming.md)                     |
| Admin view and edit an event                           | [admin-event-edit.md](./admin-event-edit.md)             |
| Collapse occasions from the admin event page           | [admin-collapse-occasions.md](./admin-collapse-occasions.md) |
| Delete or wipe an import from review                  | [import-review-delete.md](./import-review-delete.md)     |
| Publisher import notification plan                     | [publisher-import-notifications.md](./publisher-import-notifications.md) |
