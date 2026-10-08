# CLAUDE.md

Local Events: a mobile + web app that notifies people about local and digital events near them and
verifies attendance by check-in. Launch area Söderhamn / Gävleborgs län; Swedish (default) + English.

Read before larger changes:

- `docs/project-description.md` — scope, architecture, data model, key flows, security rules
- `docs/build-plan.md` — phases and checklists (what to build next)
- `docs/decisions.md` — settled decisions; don't re-litigate them silently

## Commands (run from the repo root)

```bash
pnpm install
pnpm db:up                 # Postgres + PostGIS + Valkey in Docker
pnpm db:migrate            # apply migrations (packages/db/migrations)
pnpm typecheck             # all workspaces
pnpm test                  # vitest in all workspaces
pnpm build                 # esbuild bundles for Node apps
pnpm format                # prettier
pnpm --filter @local-events/api dev
pnpm --filter @local-events/data-workers dev -- --source example-fixture
```

Always finish a change with `pnpm typecheck && pnpm test` (or the filtered equivalent).

## Layout

- `apps/api`, `apps/admin-api` — Hono + @hono/zod-openapi REST APIs (`/v1`, OpenAPI at `/v1/openapi.json`)
- `apps/worker` — SQS consumer for domain events (notifications, stats)
- `apps/data-workers` — scheduled ingestion; one adapter per source in `src/sources/<slug>/`
- `apps/mobile`, `apps/web`, `apps/admin` — **not created yet**; follow `apps/README.md`
- `packages/contracts` (zod schemas), `domain` (business rules), `auth`, `ingest`, `db` (Drizzle),
  `geo`, `config` (tsconfig presets)
- `infra` — AWS CDK, region eu-north-1

## Rules

Architecture

- Apps import packages; packages never import apps.
- Business rules live in `packages/domain` with unit tests. Route handlers and workers stay thin:
  validate → call domain → persist.
- `db`, `auth`, `ingest` are server-only (they use Node APIs). Frontends may import only
  `contracts`, `domain`, `geo` and generated API clients.
- The admin frontend talks only to the admin API.
- Data workers never write events directly in an adapter; adapters only fetch and map to
  `IncomingEvent`. The ingest pipeline validates, resolves publishers, dedupes and upserts.

Product invariants (enforced in domain, tested)

- A user id never authenticates; the app holds a device credential in secure storage.
- Events from unverified publishers are `awaiting_verification`: not listed, searched or pushed.
- Imported events from temporary publishers or review-trust sources go to `in_review`.
- Only checked-in users rate, once, within 14 days after the end. Public sees aggregates only.
  Anonymous users can score but not comment.
- No background location in v1. Region suggestions run on the device and send nothing unless saved.
- v1 has no subscription/paid plan UI anywhere. Plan limits go through `entitlementsFor()`, which
  returns the all-unlocked launch plan.

Code conventions

- TypeScript, ESM, strict. Packages export TS source (`"exports": { ".": "./src/index.ts" }`);
  imports are extensionless.
- Zod v4 APIs (`z.uuid()`, `z.iso.datetime()`, `z.url()`).
- Tests: vitest, `*.test.ts` next to the code.
- PostGIS: EWKT is `POINT(lng lat)` — longitude first. Geography columns are plain `geography`
  (see `packages/db/src/postgis.ts`). Use `ST_DWithin` / `ST_Covers` in SQL.
- Migrations: change `packages/db/src/schema.ts`, then `pnpm db:generate`. Never edit a migration
  that has been applied anywhere; add a new one.
- User-facing strings go through i18n with `sv` and `en`; never hard-code Swedish or English text in
  components.
- Never read or print `.env` files or secrets.

Docs

- When a decision changes, update `docs/decisions.md`, `docs/project-description.md` and
  `docs/build-plan.md` in the same change. Tick build-plan checkboxes when items are done.

## Skills

`.claude/skills/` has step-by-step guides: `scaffold-frontend`, `add-api-endpoint`,
`add-data-source`, `db-schema-change`, `record-decision`.
