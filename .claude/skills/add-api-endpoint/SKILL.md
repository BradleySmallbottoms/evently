---
name: add-api-endpoint
description: Add or change a REST endpoint in the public API (apps/api) or the admin API (apps/admin-api), including its Zod contract, domain rule, persistence and tests. Use this whenever the user asks for a new route, endpoint, API call, handler or backend feature such as identities, check-ins, events, ratings, subscriptions, pairing codes or admin actions.
---

# Add an API endpoint

Endpoints are thin. The order below keeps rules testable and the OpenAPI spec accurate.

1. **Decide the API.** Public (`apps/api`, used by mobile + web) or admin (`apps/admin-api`, admin
   console only). Never expose admin operations on the public API.
2. **Contract** — add request/response schemas to `packages/contracts/src` (Zod v4). Reuse
   `GeoPointSchema`, `EventStatus`, `ErrorResponse`. Export types with `z.infer`.
3. **Rule** — put any decision logic (eligibility, status transitions, limits) in
   `packages/domain/src` as a pure function with a `*.test.ts`. Check
   `docs/project-description.md` → Key flows and the invariants in `CLAUDE.md`. Plan limits go
   through `entitlementsFor()`.
4. **Persistence** — if new tables/columns are needed, use the `db-schema-change` skill first.
5. **Route** — in `apps/<api>/src`, define it with `createRoute` from `@hono/zod-openapi` and
   register with `app.openapi(route, handler)`. Path under `/v1/...`. Return `ErrorResponse` for
   errors with a stable `code`.
6. **Auth** — public routes resolve the caller from the session token (device credential → session);
   never trust a user id from the request body. Admin routes require an admin session.
7. **Side effects** — writes that others react to (publish, update, check-in, rating) enqueue a
   domain event for `apps/worker`; don't send notifications inline.
8. **Tests** — call `createApp().request(...)` in `src/*.test.ts` for the happy path and each
   rejection reason.
9. **Verify** — `pnpm --filter @local-events/<api> typecheck test`, then root `pnpm typecheck`.
   Check the route appears in `/v1/openapi.json`.
10. Tick the matching item in `docs/build-plan.md`.
