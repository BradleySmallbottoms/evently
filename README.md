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

Phase 3 (Discovery + notifications) is underway. Phase 2 is complete. Interests and saved areas
(circle + polygon) are available via `/v1/me/*` and the mobile preferences screen; region
suggestions, push, and matching remain.

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
pnpm db:up          # Postgres + PostGIS + Valkey in Docker
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

### Public events & publishers

- Public `GET /v1/events` only returns **`status = published`**. Unverified publishers’ events stay
  `awaiting_verification` until an admin verifies the publisher (which releases upcoming events).
- Empty mobile/web lists usually mean no published events nearby — not a broken client. Verify
  publishers via admin-api `POST /v1/publishers/{id}/verify` in local/dev.
- Fallback discovery point is **Söderhamn** (`61.3037, 17.0592`, 50 km).
- **Publisher profiles / invites:** owners `GET`/`PATCH /v1/publishers/{id}`, list members, create
  email invites (`POST …/invites`). Invitee signs in with the invited email and
  `POST /v1/publishers/invites/accept`. Non-prod responses may include `inviteToken`. Flow:
  [docs/flows/publisher-invites.md](docs/flows/publisher-invites.md).

### Mobile location (especially Expo web)

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
- Dev CORS defaults allow web `:3100` and Expo web `:8081` with credentials. Override with
  `CORS_ORIGINS`.

### Preferences (interests & areas)

- Mobile uses `Authorization: Bearer <sessionToken>` on `GET/PUT /v1/me/interests`,
  `GET/POST/PATCH/DELETE /v1/me/areas`, and `GET /v1/me/preferences`.
- Circle areas store `center` + `radius_m`; polygons store geography `area`. Cap 20 areas.
- Home feed prefers the primary active circle when set. Flow:
  [docs/flows/user-preferences.md](docs/flows/user-preferences.md).

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

## Scripts

| Command                                | What it does                                            |
| -------------------------------------- | ------------------------------------------------------- |
| `pnpm dev`                             | Runs every app's `dev` task through Turborepo           |
| `pnpm build`                           | Builds all apps (esbuild bundles for the Node services) |
| `pnpm typecheck`                       | TypeScript in every workspace                           |
| `pnpm test`                            | Vitest in every workspace                               |
| `pnpm test:e2e`                        | Playwright Phase 2 smoke (web + API)                    |
| `pnpm format` / `pnpm format:check`    | Prettier                                                |
| `pnpm db:up` / `pnpm db:down`          | Start/stop local Postgres + Valkey                      |
| `pnpm db:generate` / `pnpm db:migrate` | Create / apply Drizzle migrations                       |
| `pnpm api-client:generate`             | Export OpenAPI → `packages/api-client` types            |

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
