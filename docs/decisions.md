# Decision Log

Settled product and architecture decisions. Newest first within each group. When a decision
changes, update this file, `project-description.md` and `build-plan.md` together.

## Product

| Decision                  | Detail                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Business model            | Free for users, funded by ads. v1: everyone publishes for free; no subscription option anywhere. Paid publisher plans (Free/Small/Medium/Large) are a future feature; only entitlement checks exist in code. |
| Region subscriptions      | When the app is actively used somewhere new, offer to save the place as a region and notify about events there. Runs on device; nothing sent unless saved.                                                   |
| Launch area and languages | Söderhamn and Gävleborgs län; Swedish (default) and English.                                                                                                                                                 |
| Publisher members         | Owner and editor roles in v1.                                                                                                                                                                                |
| Ratings visibility        | Public sees only aggregate (average + count). Anonymous users can rate but not comment. Comments visible to publisher and admins only.                                                                       |
| Identity recovery         | Device linking via pairing code + optional recovery email, both in v1.                                                                                                                                       |
| Imported events           | Per-source trust level; new sources start in review. Unknown organizers get a temporary publisher that admins re-map or complete.                                                                            |
| Who can publish           | Anyone can register; events from unverified publishers stay hidden and are never pushed until an admin verifies the publisher. Upcoming events are then released; ended ones stay hidden.                    |
| Users                     | Anonymous by default, no registration. Profile (name or anonymous) offered at first check-in. Web login only for publishers or app users pairing via code.                                                   |
| Nearby push rules         | Match active notify areas (circle `ST_DWithin` / polygon `ST_Covers`) ∩ interest overlap (empty interests = no nearby match). Always insert a `notifications` inbox row for every match (dedupe only); always send a silent/data Expo push when a device token exists. Quiet hours (default 22:00–08:00 `Europe/Stockholm`, editable in preferences) and the 5/day cap are **client-only**: the app may post a local OS notification after a silent push, otherwise badge/inbox only. Listing and unread badge are API-backed (`GET /me/notifications`). Inbox rows older than 90 days are purged by the worker. Digital events without a point skip nearby but still notify publisher followers. Fan-out capped at 500 candidates per path per event. |

## Architecture

| Decision     | Detail                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API style    | REST + OpenAPI (Zod-first via @hono/zod-openapi) for both public and admin APIs.                                                                                    |
| Auth         | Own auth in the APIs, users/devices/sessions in Postgres. No Cognito. App stores a random device credential in secure storage; a user id alone never authenticates. |
| Data workers | Part of the monorepo (`apps/data-workers`); one adapter per source; scheduled Fargate tasks (~0.25 vCPU / 0.5 GB).                                                  |
| Hosting      | AWS, eu-north-1 (Stockholm), dev/staging/prod accounts, CDK.                                                                                                        |
| UI kit       | Material UI (`@mui/material` + `@mui/material-nextjs`) on `apps/web` and `apps/admin`. Mobile uses custom RN screens plus `@expo/ui` (universal BottomSheet/etc.) and SwiftUI overlays (`ConfirmationDialog`, `ContextMenu`, `DatePicker`, `Alert`) for system chrome — not React Native Paper / Gluestack. |
| Monorepo     | pnpm workspaces + Turborepo; Expo (mobile), Next.js (web, admin).                                                                                                   |
| Database     | PostgreSQL + PostGIS on RDS; Drizzle ORM. Geography columns are plain `geography` because drizzle-kit quotes constrained type names.                                |
| Local queues | ElasticMQ in Docker Compose as the SQS stand-in (`domain-events` + DLQ). Same `@aws-sdk/client-sqs` clients; `AWS_ENDPOINT_URL_SQS` + `DOMAIN_EVENTS_QUEUE_URL` point at localhost. Real SQS in AWS. |

## Risk mitigations (reviewed, kept as proposed)

Too few events at launch · source breakage/scraping · duplicate imports · cheap anonymous identities
(device attestation stays v2) · indoor GPS · notification fatigue · app store location review ·
digital code sharing. See `project-description.md` → Risks.

## Still open

- First 2–3 data sources for the launch area (to be supplied).
- Registration conflict with an already-imported publisher (investigate detection, proof and merge).
