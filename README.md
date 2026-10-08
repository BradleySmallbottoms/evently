# Local Events

Find events near you, get notified when something you care about is published, and check in when
you attend. iOS, Android and web, with an admin console and data workers that import events from
external sources. Launch area: Söderhamn and Gävleborgs län. Languages: Swedish and English.

- [Project description & architecture](docs/project-description.md)
- [Build plan](docs/build-plan.md)
- [Decision log](docs/decisions.md)
- [Creating the mobile, web and admin apps](apps/README.md)

## Status

Phase 1 (Foundations) has started. The backend skeletons, shared packages, database schema and
infrastructure entry point exist and are tested. **The Expo mobile app and the two Next.js apps are
not created yet**; follow [apps/README.md](apps/README.md) to create them.

## Prerequisites

- Node.js 24 LTS (`.nvmrc`; 22+ works)
- pnpm via Corepack: `corepack enable` (version pinned in `package.json`)
- Docker (local Postgres + PostGIS and Valkey)
- For the mobile app later: an Expo account and `eas-cli`
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
```

Run things:

```bash
pnpm --filter @local-events/api dev            # http://localhost:3000/health, /v1/openapi.json
pnpm --filter @local-events/admin-api dev      # http://localhost:3001/health
pnpm --filter @local-events/data-workers dev -- --source example-fixture
pnpm --filter @local-events/infra synth -c env=dev
```

## Scripts

| Command                                | What it does                                            |
| -------------------------------------- | ------------------------------------------------------- |
| `pnpm dev`                             | Runs every app's `dev` task through Turborepo           |
| `pnpm build`                           | Builds all apps (esbuild bundles for the Node services) |
| `pnpm typecheck`                       | TypeScript in every workspace                           |
| `pnpm test`                            | Vitest in every workspace                               |
| `pnpm format` / `pnpm format:check`    | Prettier                                                |
| `pnpm db:up` / `pnpm db:down`          | Start/stop local Postgres + Valkey                      |
| `pnpm db:generate` / `pnpm db:migrate` | Create / apply Drizzle migrations                       |

## Repository layout

```
apps/
  api/            Public REST API (Hono + zod-openapi) — mobile + web
  admin-api/      Admin REST API — admin console only
  worker/         SQS consumer: notifications, stats
  data-workers/   Scheduled ingestion, one adapter per source
  mobile/         Expo app            (create per apps/README.md)
  web/            Next.js web app     (create per apps/README.md)
  admin/          Next.js admin       (create per apps/README.md)
packages/
  contracts/      Zod schemas shared by APIs and clients
  domain/         Business rules (check-in, ratings, publishing, entitlements, regions)
  auth/           Device credentials, session tokens, pairing codes
  ingest/         IncomingEvent shape, adapter interface, dedupe
  db/             Drizzle schema + migrations (PostgreSQL + PostGIS)
  geo/            Distance / geofence helpers
  config/         Shared tsconfig presets
infra/            AWS CDK app (eu-north-1)
docs/             Project description, build plan, decisions
.claude/          Claude Code settings and skills
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
