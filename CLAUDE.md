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
pnpm api-client:generate   # export OpenAPI → packages/api-client types
```

Always finish a change with `pnpm typecheck && pnpm test` (or the filtered equivalent).

## Testing policy (required on every change)

After any code change, run all relevant checks before marking work done:

```bash
# Core required checks
pnpm --filter @local-events/web typecheck
pnpm --filter @local-events/admin typecheck
pnpm --filter @local-events/mobile typecheck
pnpm --filter @local-events/api test
pnpm --filter @local-events/admin-api test
```

If the change touches shared packages or backend behavior, also run:

```bash
pnpm typecheck
pnpm test
```

For runtime sanity:

- Start affected apps (`pnpm dev` or per-app dev commands) and verify they boot without runtime errors.
- For web/admin/mobile-web flows, run browser click-through smoke checks on changed pages.
- During browser smoke checks, inspect browser devtools console and fail the check on Next.js/React
  errors or warnings that indicate runtime/render/hydration problems.
- If an endpoint/feature is added or behavior changes, add/adjust tests in the same change.
- Explicitly assess test coverage gaps per change: happy path + key rejection/edge path.
- After each code change, validate that tests still pass for the touched area (and broader suites when
  needed), and explicitly check whether the change affects existing tests under `tests/`.
- If a change touches behavior covered by existing tests, update those tests in the same change; if it
  adds new behavior, add new tests in `tests/` in the same change.
- After each slice (for example a Phase checklist slice), validate and test that the slice's stated
  exit criteria are actually met before marking the slice done.

## Layout

- `apps/api`, `apps/admin-api` — Hono + @hono/zod-openapi REST APIs. Version prefix comes from
  package.json `apiVersion` (mounted as `/v{n}`); OpenAPI at `/v{n}/openapi.json`. Route paths in
  code omit the prefix.
- `apps/worker` — SQS consumer for domain events (notifications, stats)
- `apps/data-workers` — scheduled ingestion; one adapter per source in `src/sources/<slug>/`
- `apps/mobile` (Expo), `apps/web` / `apps/admin` (Next.js) — scaffolded; follow `apps/README.md`
- `packages/contracts` (zod schemas), `domain` (business rules), `auth`, `ingest`, `db` (Drizzle),
  `geo`, `config` (tsconfig presets)
- `infra` — AWS CDK, region eu-north-1

### API app layout (`apps/api`, `apps/admin-api`)

```
src/
  app.ts                 # createApp: middleware, registerRoutes, OpenAPI doc
  index.ts               # process entry: wire DB/memory services → createApp → serve
  routes/                # HTTP only — one file per resource group
    index.ts             # registerRoutes(app, services)
    health.ts
    identities.ts        # (public API)
    sessions.ts
    publishers.ts
    categories.ts
    events.ts
    …
  services/              # persistence / adapters (db + memory implementations)
    auth/                # or publishers.ts, events/, …
    events/
    …
```

- Put new endpoints in `routes/<group>.ts` (e.g. `events.ts`, `publishers.ts`). Do not define
  `createRoute` handlers in `app.ts` or under `services/`. Paths omit the version prefix
  (`/identities`, not `/v1/identities`); `apiVersion` in that app's `package.json` sets
  `API_PREFIX` (e.g. `/v1`) in `src/config.ts`.
- Put AuthServices / EventServices / DB + memory backends in `services/<group>/` (or a single
  `services/<group>.ts` when small). Routes call services; services call domain + db.
- `app.ts` stays thin: error handler, CORS (public API), mount at `API_PREFIX`, OpenAPI.

## Rules

Architecture

- Apps import packages; packages never import apps. API apps must not import each other.
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
- Tests: vitest, all test files live under the repo root `tests/` directory.
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
- After **every new major feature**, in the same change:
  1. Add or update **Need to know** bullets in the root `README.md` (dev/ops gotchas, invariants).
  2. If the feature has non-trivial **client → API → DB** sequencing, add a Mermaid flowchart under
     `docs/flows/<feature>.md` and link it from `docs/flows/README.md` and the README Need-to-knows
     section.

## Skills

`.claude/skills/` has step-by-step guides: `scaffold-frontend`, `add-api-endpoint`,
`add-data-source`, `db-schema-change`, `record-decision`. Frontend UI skills live under
`.agents/skills/`.

### Frontend UI (required)

1. **Admin and web (`apps/admin`, `apps/web`)** — always use the **MUI** skill before building
   or changing UI. Read `.agents/skills/mui/SKILL.md` (and
   `.agents/skills/mui/resources/` as needed). Use stock `@mui/material` with typed `sx` /
   theme tokens; Next App Router via `@mui/material-nextjs/v16-appRouter`. Do not use
   Gluestack, UniWind, React Native Paper, or `react-native-web` in these apps.

2. **Mobile (`apps/mobile`)** — always use the **expo-ui** skill (and **expo-native-ui** for
   layout/HIG). Read `.agents/skills/expo-ui/SKILL.md` before building or changing UI.
   Prefer `@expo/ui` for sheets, pickers, menus, toggles; SwiftUI (`@expo/ui/swift-ui`) for
   ConfirmationDialog, ContextMenu, DatePicker, Alert/popups (in `src/components/**/*.ios.tsx`,
   never under `app/`). Custom RN components for everything else. Do not use React Native
   Paper or MUI. Strive for the look and feel of
   [Events Booking Mobile App](https://dribbble.com/shots/25922019-Events-Booking-Mobile-App)
   (soft canvas, coral accent, large continuous corner radii, hero event cards, clear
   location/search/category header, sticky primary CTA on detail).

### Frontend component placement (required)

Keep UI colocated by reuse scope. Apply the same idea on web, admin, and mobile.

**Admin / web (Next.js App Router)** under `apps/<app>/src/`:

- Reusable across routes → `components/` (e.g. `components/page-main.tsx`, theme/chrome).
- Unique to one route/view → that route’s `components/` folder
  (e.g. `app/[locale]/login-with-code/components/login-with-code-form.tsx`).
- `page.tsx` / `layout.tsx` stay thin: compose route `components/` + shared `components/`.

**Mobile (Expo Router)** under `apps/mobile/src/`:

- Reusable across screens → `components/` (`components/ui/`, chrome such as tabs/splash).
- Unique to one screen → that route’s `_components/` folder (Expo private folder so it is not
  a route; same role as Next `components/`), e.g. `app/events/[id]/_components/…`.
- `@expo/ui` / SwiftUI overlays stay in `components/native/**` (including `*.ios.tsx`), never
  under `app/`, even when only one screen uses them.

**When adding or changing a component:**

1. Search the same app for an existing component that already does the job (or close enough).
2. If it can be reused from another route, move/refactor it into `src/components` (or
   `components/ui` / `components/native` on mobile) and update imports.
3. Do not leave a second copy under a route `components/` / `_components/` folder.
4. Do not put route-only widgets in the shared `components/` tree.

### Quality gates

- **`code-tester`** — launch after any code change (even outside the pipeline) to run typecheck, lint, and tests; loop on its failures before proceeding.
- **`code-reviewer`** and **`security-auditor`** — launch **in parallel, in one message**, once tests pass and before anything is committed. Reviewer covers quality/architecture; auditor covers OWASP-class issues, auth gaps, secrets, and the data-isolation boundary.
