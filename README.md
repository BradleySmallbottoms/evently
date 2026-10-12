# Local Events

Find events near you, get notified when something you care about is published, and check in when
you attend. iOS, Android and web, with an admin console and data workers that import events from
external sources. Launch area: Söderhamn and Gävleborgs län. Languages: Swedish and English.

- [Project description & architecture](docs/project-description.md)
- [Build plan](docs/build-plan.md)
- [Decision log](docs/decisions.md)
- [Flow charts (client → API → DB)](docs/flows/README.md)
- [Creating / wiring frontends](apps/README.md)

## Status

Phase 4 (Check-in) is underway. Phase 3 nearby push and follows are in place. Physical geofence
Phase 5 (ratings + stats) is in place. Phase 6 beta/hardening and parallel admin/data-worker tracks
remain.

## Prerequisites

- Node.js 24 LTS (`.nvmrc`; 22+ works)
- pnpm via Corepack: `corepack enable` (version pinned in `package.json`)
- Docker (local Postgres + PostGIS and Valkey)
- For the mobile app: an Expo account and `eas-cli` when building natively
- For deploying: AWS credentials and the AWS CDK (installed as a dev dependency)

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm db:up          # Postgres + PostGIS + Valkey + ElasticMQ (local SQS) + Garage (local S3)
pnpm db:migrate     # apply packages/db/migrations
pnpm typecheck
pnpm test
pnpm dev            # API :3000, admin-api :3001, web :3100, admin :3200, mobile Metro :8081
```

Useful singles:

```bash
pnpm --filter @local-events/api dev
pnpm --filter @local-events/admin-api dev
pnpm --filter @local-events/web dev
pnpm --filter @local-events/mobile dev
pnpm --filter @local-events/data-workers dev -- --source example-fixture
pnpm api-client:generate   # after public API OpenAPI changes
```

## Need to know

Operational and product facts that bite during local development. **Update this section (and add
a diagram under [`docs/flows/`](docs/flows/README.md) when the feature has complex client→API→DB
calls) in the same change as every new major feature.**

### Visit Söderhamn import

- First external source is the Citybreak API used by Visit Söderhamn. The worker loads the category
  tree, then products in **Evenemang** (category `30172`) only. Each occasion becomes its own event.
  Categories under Evenemang are stored as tags (`external_id` `visit-soderhamn:{id}`) and attached
  to the imported event. `GET /v1/tags` is that list. The mobile home and search call it with
  `?upcoming=true`, which keeps only tags on a published event that has not ended. Choosing
  preferred tags loads the full list. Publishers and admin do too.
  A fresh database is seeded with the seven tags from the local fixture; a live run adds the rest.
- Set `VISIT_SODERHAMN_API_KEY` before a live run. The key is not stored in `data_sources.config`.
  The seeded row stays **disabled**, so nothing runs it on a timer. A manual run still saves.
  Flow: [docs/flows/visit-soderhamn.md](docs/flows/visit-soderhamn.md).
- `pnpm --filter @local-events/data-workers dev -- --source visit-soderhamn` writes events as
  `in_review` under a temporary publisher per contact email. They do not show up in the public
  list until an admin publishes them.   The same run again skips unchanged events. A booking link
  (`Bokningslänk`) is stored as a `tickets` link. The event link and website are `info` links.
  Every source also stores http(s) links found in the description (tickets, registration, or info).
  A price is stored only when the description says gratis or states an amount in kr
  (öre). An event with no price is treated as free in the list filter. Cards show
  a known price as `100kr`.
- Hero images are copied into Garage when `PUBLIC_ASSETS_BUCKET` is set (`pnpm db:up`). The public
  API returns `imageUrl` only when `ASSETS_PUBLIC_BASE_URL` is set. After the first Garage start,
  allow anonymous reads once:
  `docker compose exec garage /garage bucket website --allow local-events-assets`.
  Objects are then `http://local-events-assets.localhost:3902/events/{eventId}/main`.
  A phone running Expo Go cannot open `*.localhost`. The app rewrites those image
  URLs to `GET /v1/assets/…` on the API host, and the API fetches Garage. The phone
  still needs `EXPO_PUBLIC_API_URL` set to this computer's LAN address.
  Browse the buckets at `http://localhost:3909` (Garage Web UI).
  In AWS the same key is served from CloudFront (`ASSETS_PUBLIC_BASE_URL`).

### Event share links

- Mobile share uses the OS sheet with `EXPO_PUBLIC_WEB_URL/events/{id}` (default local web
  `http://localhost:3100`). Copy link uses the same URL.
- Opening that HTTPS URL in the installed app needs Universal / App Links: set
  `EXPO_PUBLIC_WEB_URL` to the https production host (rebuild native so
  `associatedDomains` / `intentFilters` apply), and on web set `APPLE_TEAM_ID` plus
  `ANDROID_SHA256_CERT_FINGERPRINTS` so `/.well-known/apple-app-site-association` and
  `/.well-known/assetlinks.json` are served.

### Check-in

- Check-in is off on an event until an admin turns it on in the event editor. The publisher can
  then add extra text and links. Attendees see those only after they check in
  (`GET /v1/events/{id}/content`). A later import does not clear the flag or that text.
  Flow: [docs/flows/attendee-content.md](docs/flows/attendee-content.md).

### Featured events

- Admins set `featured` on an event in the catalog editor. `GET /v1/events` sorts featured events
  first, then by start time. `tagId` or comma-separated `tagIds` keeps events that have any of
  those tags, and `offset` plus `nextOffset` page the list. The mobile home, search, and events
  lists pass the selected tag and load the next page at the end of the scroll. When the user has
  preferred tags, the home page shows a For you carousel of nearby events with any of those tags.
  The featured row stays hidden when that page set has no featured events.
  Imports do not write the flag, so a later sync leaves it set. Paid placements (slot, dates, plan
  quota) are still a later feature.
  Flow: [docs/flows/admin-event-edit.md](docs/flows/admin-event-edit.md).

### Saved events, lists, and links

- A save is `PUT /v1/me/saved-events/{eventId}` for the device session. It is not a notification
  follow (`/me/subscriptions`). Custom lists live at `/v1/me/lists` (20 lists, 100 events each).
  Both are deleted with the user.
- Tickets and registration are links on the event (`type` `tickets`, `registration`, or `info`).
  Price is optional minor units: missing means unknown, `0` means free.
  A later import that omits price, currency, online URL, or links leaves those fields as they are.
  Flow: [docs/flows/saved-events.md](docs/flows/saved-events.md).

### Public events & publishers

- Public `GET /v1/events` only returns **`status = published`**. Unverified publishers’ events stay
  `awaiting_verification` until an admin verifies the publisher (which releases upcoming events).
- **Push drafts:** publishing creates a `push_messages` row. Trusted publishers auto-approve;
  others need admin approval under **Pushes**. After a send, publishers can **Notify again**
  (`POST /v1/manage/events/{id}/push-message`). Admins can schedule **broadcasts**
  (`POST /v1/push-messages/broadcast`) to everyone or users with a favorite tag. The worker
  sends approved due messages (optional `send_at`); inbox rows appear only then. Per-user
  aggregation within 10 minutes combines alerts. Audience estimate:
  `GET /v1/push-messages/{id}/audience`. Flow:
  [docs/flows/push-and-domain-events.md](docs/flows/push-and-domain-events.md).
- Admins open an event from **Events** (`/events/manage`) or import review. `GET/PATCH /v1/events/{id}`
  on the admin API edits title, schedule, place, price, tags, links, and status. Saving a
  published event enqueues `event.updated`. Changing status to `published` enqueues `event.published`.
  A status-only cancel does not re-check place or online URL. Flow:
  [docs/flows/admin-event-edit.md](docs/flows/admin-event-edit.md).
- Empty mobile/web lists usually mean no published events nearby — not a broken client. Verify
  publishers via admin console (`apps/admin` → Publishers) or
  `POST /v1/publishers/{id}/verify` (admin session cookie / Bearer). Bootstrap first admin with
  `ADMIN_BOOTSTRAP_EMAIL` + `ADMIN_BOOTSTRAP_PASSWORD`; enroll TOTP on first login.
- Fallback discovery point is **Söderhamn** (`61.3037, 17.0592`, 50 km).
- **Publisher profiles / invites:** owners `GET`/`PATCH /v1/publishers/{id}`, list members, create
  email invites (`POST …/invites`). Invitee signs in with the invited email and
  `POST /v1/publishers/invites/accept`. Non-prod responses may include `inviteToken`. Flow:
  [docs/flows/publisher-invites.md](docs/flows/publisher-invites.md).

### Mobile location (especially Expo web)

- First launch shows an **onboarding carousel** (welcome → notifications → location). Activate
  requests the OS permission; Skip stores the choice and deferred **reminders** reappear after
  every 5 app activations (one permission at a time). Reset app data clears this state.
- Home event queries use **existing** location permission only (no prompt). Check-in and onboarding
  / reminders own the permission request.
- Resolving GPS can hang on web permission prompts. The app **times out** (≈2s on web) and falls
  back to Söderhamn so the events query can run. Switching tabs used to “fix” a hung prompt —
  that should no longer be required.
- Queries chain: identity → query point → `GET /v1/events`. Use `isLoading` (not bare `isPending`)
  so disabled queries don’t look stuck forever.

### Pairing & sessions

- **Web login:** phone generates `POST /v1/pairing/code`; browser exchanges with
  `POST /v1/pairing/login` from a **client** form (`credentials: 'include'`). Never exchange the
  code in a Next.js server component — that burns the single-use code without setting the browser
  cookie. Flow: [docs/flows/web-pairing-login.md](docs/flows/web-pairing-login.md).
- **Device linking:** new phone `POST /v1/pairing/device-link/code`; old phone
  `POST /v1/pairing/device-link/confirm`; new phone then `POST /v1/sessions` to pick up the new
  `userId`. Only the device that created the code is remapped. Flow:
  [docs/flows/device-linking.md](docs/flows/device-linking.md).
- App identity is a **device credential** in secure storage (localStorage on web), not the user id.
  Onboarding creates it with `POST /v1/identities` before the notification prompt, and shows again
  when that credential is missing. On the iOS Simulator set `EXPO_PUBLIC_API_URL` to
  `http://127.0.0.1:3000/v1` (`localhost` resolves to IPv6 and the request fails). A physical phone
  needs the Mac's LAN address.
- Dev CORS defaults allow web `:3100` and Expo web `:8081` with credentials. Override with
  `CORS_ORIGINS`.
- **Admin console host aliases:** prefer `http://localhost:3200`. Opening via an `/etc/hosts`
  alias requires `ALLOWED_DEV_ORIGINS` (admin Next config) and matching `ADMIN_CORS_ORIGINS`,
  otherwise `/_next` is 403 and the login form appears to do nothing. Session cookies are
  `SameSite=Lax` on the admin API host — keep the UI and `NEXT_PUBLIC_ADMIN_API_URL` on the
  same site (e.g. both `localhost`, or both `*.your-alias`) or the cookie will not stick.
- **Admin queues:** `/events` reviews `in_review` imports (publish/reject); `/events/manage`
  patches status. `/publishers` verifies, remaps/completes temporary publishers, and toggles
  verified. `/moderation` hides ratings and bans users (banned users cannot create sessions or
  use existing ones). `/audit-log` lists admin actions. Ingest raw payloads go to S3 as
  `raw/<source>/<runId>` when `RAW_INGESTION_BUCKET` is set.
- **Data workers:** `pnpm --filter @local-events/data-workers dev -- --source visit-soderhamn`
  (needs `data_sources` row + `VISIT_SODERHAMN_API_KEY`). Generic ICS calendars use slug
  `ics-feed` with `config.feedUrl` (https). Review-trust sources stay silent until an admin
  publishes from the review queue.

### Preferences (interests & areas)

- Mobile uses `Authorization: Bearer <sessionToken>` on `GET/PUT /v1/me/interests`,
  `GET/POST/PATCH/DELETE /v1/me/areas`, and `GET /v1/me/preferences`.
- Circle areas store `center` + `radius_m`; polygons store geography `area`. Cap 20 areas.
- Home feed prefers the primary active circle when set. Flow:
  [docs/flows/user-preferences.md](docs/flows/user-preferences.md).
- **Regions:** `GET /v1/regions/lookup?lat&lng` uses `ST_Covers` on seeded fixtures (Söderhamn
  kommun / Gävleborg län). Mobile may offer save via `shouldSuggestRegion`; accept posts
  `regionId` (or 15 km circle fallback). Declines stay on-device. Flow:
  [docs/flows/region-suggestions.md](docs/flows/region-suggestions.md).

### Push + domain events

- Mobile calls `PUT /v1/me/push-token` with Bearer session + `deviceCredential` + Expo token once
  identity is ready and again after a session refresh. The OS prompt happens only from onboarding
  Activate and reminders. No-op on web, or when permission is still denied.
- Local queues: `pnpm db:up` starts **ElasticMQ** (SQS-compatible) on `:9324` (UI `:9325`). Copy
  `DOMAIN_EVENTS_QUEUE_URL` / `AWS_ENDPOINT_URL_SQS` from `.env.example`. Queue definitions live in
  `infra/local/elasticmq.conf` (add new queues there as consumers appear).
- Publishing a **`published`** event (or admin verify releasing one) enqueues
  `{ type: 'event.published', eventId }` best-effort after the DB write. Without
  `DOMAIN_EVENTS_QUEUE_URL`, APIs keep events in-process and the worker idles.
- Worker fan-out: nearby (areas ∩ interests) + publisher followers → always insert
  `notifications` inbox row → silent Expo push (data + badge). Quiet hours + 5/day OS-notification
  cap are enforced on the mobile client (local notification vs badge only). Inbox list/badge via
  `GET /me/notifications` (`unreadCount`). Rows older than 90 days are purged. Toggle quiet hours
  with `PUT /me/quiet-hours`. Follow via `POST /v1/me/subscriptions`. Needs `DATABASE_URL` on the
  worker. Flow: [docs/flows/push-and-domain-events.md](docs/flows/push-and-domain-events.md).

### Frontend structure

- Admin/web: **MUI** only. Mobile: custom UI + `@expo/ui` / SwiftUI overlays (not Paper/MUI).
- Shared components → `src/components/`. Route-only → Next `app/.../components/`, Expo
  `app/.../_components/`. Native/SwiftUI overlays stay under `apps/mobile/src/components/native/`.
  Details in `CLAUDE.md`.

### Ports (local)

| App        | Port |
| ---------- | ---- |
| API        | 3000 |
| Admin API  | 3001 |
| Web        | 3100 |
| Admin      | 3200 |
| Mobile web | 8081 |
| E2E API    | 3090 |
| E2E web    | 3190 |

### Event reminders

- **Påminn mig** on an event opens a picker for local notifications: the day before the
  start, an hour before, and at the start. The user picks one or more of the times that are
  still ahead. Tapping the button again opens the same picker, where the reminders can be
  changed or removed. Nothing is stored on the server. On the web the button explains that
  reminders belong in the phone app.

### Check-in

- Physical geo: `GET /v1/events/{id}/check-in` + `POST /v1/events/{id}/check-ins` with Bearer
  session, high-accuracy lat/lng, and `accuracyM`. Domain enforces window (30 min before start →
  end), accuracy ≤ 100 m, and circle geofence (`geofenceRadiusM`, default 100). Unique per
  user+event. Flow: [docs/flows/geo-check-in.md](docs/flows/geo-check-in.md).
- Digital / venue QR: publisher `POST /v1/manage/events/{id}/digital-code/start` (cookie) then
  polls `GET …/digital-code` for the rotating 6-char code + `localevents://check-in/{id}?c=…`
  payload. Attendees `POST /v1/events/{id}/check-ins/code` with `{ code }` once `codeActive`.
  Secret stays server-side (HMAC per 60s slot). Flow:
  [docs/flows/digital-code-check-in.md](docs/flows/digital-code-check-in.md).
- First check-in profile: `GET/PUT /v1/me/profile` — named (`displayName` + public) or anonymous;
  optional `recoveryEmail` stored unverified. Mobile prompts when `profileChosen` is false.
  Flow: [docs/flows/profile-at-check-in.md](docs/flows/profile-at-check-in.md).
- Attendee content: publisher CRUD on `/manage/events/{id}/content`; attendees
  `GET /events/{id}/content` (attendee-only rows after check-in). File `s3Key` → short-lived signed
  URL (memory signer in dev). Mobile caches checked-in payloads offline.
  Flow: [docs/flows/attendee-content.md](docs/flows/attendee-content.md).
- Ratings: `GET/POST /events/{id}/rating(s)` after check-in from `ends_at` → +14 days. Public
  aggregate only; comments need named profile and appear on
  `GET /manage/events/{id}/ratings`. Flow: [docs/flows/ratings.md](docs/flows/ratings.md).
- Stats: single EAV `stats` table. Worker expands lifetime + day/week/month/year keys and
  always `PUT`s via the API (`STATS_API_URL`/`API_URL` + `STATS_WORKER_TOKEN`) — never
  writes `stats` directly. Nightly `STATS_RECONCILE_MS` (default 24h) resets lifetime keys
  from source tables (reads DB, writes via API). Read via
  `GET /stats/{sourceType}/{sourceId}?key=numCheckins&key=…`. Averages =
  `totalRatingValue / numRatings`. Flow: [docs/flows/stats.md](docs/flows/stats.md).

### E2E vs local data

- Vitest uses in-memory stores — never touches Postgres.
- Playwright (`pnpm test:e2e`) starts its own API/web on **3090/3190** against the disposable
  `events_e2e` database (created by `pnpm db:e2e:setup`). It does **not** reuse `pnpm dev` on
  :3000/:3100, so your day-to-day `events` DB stays clean. Wipe e2e data anytime with
  `docker compose exec postgres psql -U events -c 'DROP DATABASE events_e2e'` then
  `pnpm db:e2e:setup`.

## Scripts

| Command                                | What it does                                             |
| -------------------------------------- | -------------------------------------------------------- |
| `pnpm dev`                             | Runs every app's `dev` task through Turborepo            |
| `pnpm build`                           | Builds all apps (esbuild bundles for the Node services)  |
| `pnpm typecheck`                       | TypeScript in every workspace                            |
| `pnpm test`                            | Vitest in every workspace                                |
| `pnpm db:e2e:setup`                    | Create/migrate disposable `events_e2e` DB for Playwright |
| `pnpm test:e2e`                        | Playwright smoke against `events_e2e` (ports 3090/3190)  |
| `pnpm format` / `pnpm format:check`    | Prettier                                                 |
| `pnpm db:up` / `pnpm db:down`          | Start/stop local Postgres, Valkey, ElasticMQ, and Garage |
| `pnpm db:generate` / `pnpm db:migrate` | Create / apply Drizzle migrations                        |
| `pnpm api-client:generate`             | Export OpenAPI → `packages/api-client` types             |

## Repository layout

```
apps/
  api/            Public REST API (Hono + zod-openapi) — mobile + web
  admin-api/      Admin REST API — admin console only
  worker/         SQS consumer: notifications, stats
  data-workers/   Scheduled ingestion, one adapter per source
  mobile/         Expo app
  web/            Next.js public web (MUI)
  admin/          Next.js admin (MUI)
packages/
  contracts/      Zod schemas shared by APIs and clients
  domain/         Business rules (check-in, ratings, publishing, entitlements, regions)
  auth/           Device credentials, session tokens, pairing codes
  ingest/         IncomingEvent shape, adapter interface, dedupe
  db/             Drizzle schema + migrations (PostgreSQL + PostGIS)
  geo/            Distance / geofence helpers
  api-client/     Generated OpenAPI client for the public API
  config/         Shared tsconfig presets
infra/            AWS CDK app (eu-north-1)
docs/             Project description, build plan, decisions
docs/flows/       Mermaid e2e flow charts for major features
tests/            Vitest + Playwright (not colocated under apps/)
.claude/          Claude Code settings and skills
.agents/skills/   Frontend UI skills (MUI, Expo UI, …)
```

## Docker images

Each Node service has a Dockerfile; build from the repo root:

```bash
docker build -f apps/api/Dockerfile -t local-events-api .
docker build -f apps/data-workers/Dockerfile -t local-events-data-workers .
```

## Working with Claude Code

`CLAUDE.md` describes the commands, layout and rules. Skills in `.claude/skills/`:

| Skill               | Use it for                                         |
| ------------------- | -------------------------------------------------- |
| `scaffold-frontend` | Creating `apps/mobile`, `apps/web` or `apps/admin` |
| `add-api-endpoint`  | New routes in the public or admin API              |
| `add-data-source`   | New ingestion sources (API, ICS/RSS, scraper)      |
| `db-schema-change`  | Drizzle schema changes and migrations              |
| `record-decision`   | Keeping the docs in sync when a decision changes   |

`.claude/settings.json` allows the common pnpm/git commands and blocks reading `.env` files and
running CDK deploys.
