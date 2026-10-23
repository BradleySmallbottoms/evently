# CLAUDE.md

Local Events: a mobile + web app that notifies people about local and digital events near them and
verifies attendance by check-in. Launch area Söderhamn / Gävleborgs län; Swedish (default) + English.

Read before larger changes:

- `docs/project-description.md` — scope, architecture, data model, key flows, security rules
- `docs/build-plan.md` — phases and checklists (what to build next)
- `docs/decisions.md` — settled decisions; don't re-litigate them silently
- `DESIGN.md` — visual and interaction source of truth for `apps/mobile` and `apps/web`.
  Read it before any UI work in those apps.
- `docs/reference-app.png` — look-and-feel reference when building UI in `apps/mobile` and
  `apps/web`. Open the image and match it; do not rely on a written summary alone.

## Commands (run from the repo root)

```bash
pnpm install
pnpm db:up                 # Postgres + PostGIS + Valkey + ElasticMQ (local SQS) in Docker
pnpm db:migrate            # apply migrations (packages/db/migrations)
pnpm typecheck             # all workspaces
pnpm test                  # vitest in all workspaces
pnpm build                 # esbuild bundles for Node apps
pnpm format                # prettier; staged files are formatted again on commit
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
  `IncomingEvent`. The ingest pipeline validates and upserts. A new import stays `pending_scan`
  until the scan job resolves the publisher, duplicate check, and tags. Steps the scan lists
  from the description are stored on `meta.instructions`. Tip chat lines, and a step that only
  asks someone to confirm a field, are left out.

Import adapters (every new source)

- Fetch with `ctx.fetch`. Read URLs and ids from `data_sources.config`. A secret stays in the
  environment. Prefer an official API, then ICS, then the JSON or RSS the page already loads, then
  HTML. Stay on the configured host. A redirect to another host fails that request. Read
  `robots.txt` and do not request a disallowed URL. Sitevision disallows `/*;jsessionid=*`, so
  pagination uses a clean URL (`skip`, `start`, or the JSON route) and never a session id.
  `each()` saves one event before the next page or product is fetched. A new source starts at
  trust `review`. The seed stays disabled. The schedule is `0 */6 * * *`.
- Times go through `sourceDateTime`. A `Z` or a numeric offset is that instant. A clock with no
  zone is `stockholmWallTime` (Europe/Stockholm). The same start and end, or a date with no clock,
  is a whole day. A page or row with no readable date is still saved, with `startsAt` and `endsAt`
  omitted.
- Links are `tickets`, `registration`, `info`, `facebook`, or `instagram`, at most 10. The event's
  own page is `info`. A booking or ticket URL (`ticket`, `biljett`, `tickster`, `nortic`,
  `ticketco`, `bokning`, `booking`), and Destination Hälsingland's booking URL and the label
  Evenemangslänk, are `tickets`. Anmälan, signup, registration, Typeform, and Google Forms are
  `registration`. A labeled Facebook page (Facebooksida), or a `facebook.com` URL, is `facebook`.
  A labeled Instagram page (Instagramsida), or an `instagram.com` URL, is `instagram`. A labeled
  website (Webbsida) or any other http(s) link is `info`. `parseLinksFromText` reads anchors,
  markdown, and bare URLs. Image files are skipped. `mergeImportedLinks` keeps the adapter links
  and their types, then fills from the description. Ticket shops, Facebook, and Instagram are not
  organizer keys.
- `meta.address` comes from `eventAddress`: street, five-digit postcode, city, `country: Sweden`,
  and a point only when the source gave coordinates. The adapter does not geocode. `meta.freeEntry`
  is set when the source says the event is free (`Gratis`, `fritt inträde`, `fri entré`,
  `kostnadsfritt`, or a flag such as `freeEntry` `Ja`). `priceAmount` is then `0` and `currency`
  is `SEK`. A `kr` amount in the text is minor units. An unknown price is omitted. `meta.ageLimit`
  is set only when the source states a minimum age (`Åldersgräns`, or `från N år`). Accessibility
  flags are set only when the source says they are true. `tags` stay empty. `categoryHints` may
  carry the source's own category names. The scan assigns tags. A later import that
  sends no tags leaves them in place.
- `organizerKeys()` is the ordered list: ids, email, an info-link host plus its path, that host,
  the name, then the slug fallback only when nothing else identifies the organizer. `skipHosts`
  includes the source site. Visit Söderhamn, Glada Hudik, and Destination Hälsingland store every
  showing of one product on that one event as `event_occasions` rows. A calendar that already
  lists one showing per row stores that row as one event. The page or item id is the external id.

Product invariants (enforced in domain, tested)

- An event's `language` is `sv` or `en` (default `sv`) and is the language of its title, description,
  and summary. Other languages are rows in `event_translations`: one row per event and language,
  with the translated fields in `data` as a JSON object.
- A user id never authenticates; the app holds a device credential in secure storage.
- Events from publishers that are not `published` are `awaiting_verification`: not listed, searched or pushed.
- An event without a point is omitted from the public event list. Tags do not replace a missing
  point. It has no map pin and does not match nearby push. Direct lookup by id still returns it.
  The list also leaves out an event that has ended. A whole day, the same start and end, stays
  through that calendar day. The Show events buttons count that list with `GET /events/count` for the current place, tags, date, price, and search text. Caching is planned in `docs/flows/event-counts.md`. Home, calendar, and search category buttons are tags on a current
  published event inside the selected place. An event without a point does not add a category.
- A new data-worker import is `pending_scan` until the scan job finishes. It becomes `published`
  only when the scan approves it, the publisher status is `published` and the publisher is not temporary, and the source
  trust is `auto_publish`. A temporary publisher, a publisher that is not `published`, or a review-trust
  source goes to `in_review`. Several publishers from one source can share an organizer key.
  A new temporary publisher is `pending_scan`. A separate publisher scan looks that organizer up on the
  web. The profile is stored on `publishers.meta.lookup`. A website from a fetched page is also stored as an organizer key. A finished lookup sets `in_review`. A failed lookup leaves the
  publisher `pending_scan`.
- An imported physical event with no venue name stores the city from its scraped address on `meta.import.venueName`. When that
  address has no city, the nearest city within 25 km of its point is used. A name the adapter already set stays on that field.
- Visit Söderhamn, Glada Hudik, and Destination Hälsingland store one product as one event, with each
  showing on `event_occasions`. An import with no occasion, and a library page or ICS event with no date, is still saved, with empty start and end.
  The event scan fills both when it can read them from the text or from the ticket or info page.
  The model may read that page for tags, instructions, and the summary.
  A page on visit.destinationhalsingland.se is fetched with curl over HTTP/1.1.
  An event with no start stays off the public list.
  Importers store a scraped point and the street, postcode, and city on `meta.address`. They do not
  geocode. The model returns an address in the scan JSON. The scan keeps a scraped point. When the
  event has none, it geocodes the scraped address, or the model address when the import stored none.
  A street, or a postcode and city, is geocoded. When that finds nothing, or the address is only a city, the city is geocoded. Only a hit in Sweden is kept. The model does not supply coordinates.
  The model returns possible venue names. Importers leave `events.venue_name` empty and store the name on `meta.import.venueName`. Visit Söderhamn also stores the arena name on `meta.import.arenaName`. The scan prompt passes the arena name, then that venue name, as the location. The highest rank above 80 is written. When the model returns none, the arena name is written, then the imported venue name. A later import does not clear a venue the scan already wrote.
  Showings stay on `event_occasions`. They are not copied onto `meta.occasions`. The mobile event page
  lists that event's occasion rows that have not ended.
  The same start and end is a whole day: the time reads “Whole Day”, and that occasion stays current through its calendar day.
  Admin can fold selected events into the open event (`POST /events/{id}/collapse`).
  Their occasion rows and child rows move onto it, and the checked events are deleted.
- A lookalike within 500 m and 30 minutes is still inserted, then marked `in_review` by the scan
  job, with `meta.possibleDuplicate` pointing at the existing event. A duplicate ranked over 90 as
  another showing stores `meta.possibleOccasionGroupId` on the scanned event and those duplicates.
  An existing `possibleOccasionGroupId` is reused; otherwise a new id is created. Public responses omit it.
  Admin uses that id to list events it can fold together.
  A link matches on host and path;
  protocol, query, and a trailing slash are ignored. A Citybreak product id matches with or
  without the `cbis:` prefix. The same source id updates its own row.
- Deleting an event without permanent delete sets its status to `deleted` and leaves the row. It disappears from event lists. A later import finds that source id, sees `deleted`, and skips it. Permanent delete removes the row and skips that source id on later imports.
  Permanent delete refuses when someone has checked in, saved, rated, or been notified.
  Rejecting it cancels the event and leaves the row.
  Scan again (`POST /events/{id}/rescan`) sets an imported `in_review` or `published` event back to
  `pending_scan`, clears the scan lease, and cancels open reminders so the scan job claims it.
  A published event leaves the public list until that scan finishes.
- Script-imported events are notified only when the publisher status is `published` and its import
  notification plan is set. Future reminders are approved when the event is published, and
  stored as pending while the event is still in review. Publishing the event approves them.
  Nothing means no import notification.
- Only checked-in users rate, once, within 14 days after the end. Public sees aggregates only.
  Anonymous users can score but not comment.
- A save is the interested bookmark. "I'm coming" is a separate row. Popularity is `numSaved` +
  `numComing` on the event stats (a person who did both counts twice). Events with a total of 0 are
  omitted from `sort=popular`.
- No background location in v1. While the app is in use, location is read when it becomes active
  and watched until it backgrounds. Region suggestions run on the device and send nothing unless saved.
  The prompt stays hidden while onboarding covers home, including when location permission is
  granted, and until the device then moves about a kilometre.
  A dismiss, including skipping the onboarding area step, stays quiet near that place for 7 days;
  farther than the profile setting “How far can you go”
  (default 25 km) the prompt can show again. Continuing the onboarding area step stores the
  chosen radius as that travel distance; skipping leaves the default. The onboarding tags step
  stores the chosen tags as the device home filters and on the area just saved. There is no
  account-wide interest list. Nearby notifications use the tags on the covering area. A follow of a
  publisher receives every notification for that publisher’s events. Skip stores an empty selection
  and turns that area’s notifications off.
  Each saved area keeps its own tags: the home filters
  follow the area chosen in the location menu, and “Near you” keeps the device filters. The
  location menu search radius is remembered per place on the device and on the user.
  A new circle starts with that search radius equal to its notification radius.
- v1 has no subscription/paid plan UI anywhere. Plan limits go through `entitlementsFor()`, which
  returns the all-unlocked launch plan.
- A user tip is read by Anthropic, then saved as an imported `pending_scan` event on the disabled
  `user-tips` source. Trust stays `review`, so the scan leaves the event and the tip `in_review`
  until an admin publishes the event. That sets the tip's scan status to `published`. `meta.fromUserTip` is public and does not name the submitter. The event
  description is the written description. The chat lines are stored on `meta.tip`, which public
  responses omit. The scan prompt receives those lines along with the written description. The tip push is
  visible, ignores quiet hours and the daily cap, and says the event was added only when it is
  published. A published tip opens the thank-you screen. Any other result opens the tip status. A
  lock-screen tap does the same. The inbox row opens the thank-you screen when the tip is published, and the tip status in a bottom sheet otherwise. Tip text and photos cascade with the user. The event stays.

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

Git / commits

- **Never create a git commit without the user's explicit permission in that same turn** (e.g.
  “commit”, “commit this”, “create a commit”). Permission does **not** carry forward to later
  turns or later slices in the same turn.
- **One ask → one commit** of the work already done (or currently staged/ready). After that commit,
  do **not** create further commits unless the user asks again. Phrases like “commit and continue”,
  “commit then keep going”, or “commit and carry on” mean: commit **once** now, then continue
  implementing **without** committing again when later slices finish.
- Do **not** treat “continue”, “finish”, “wrap up”, “done”, or completing a build-plan checkbox as
  permission to commit.
- Do not push, amend, rebase, or force-push unless the user explicitly asks for that action.

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

**Design references (`apps/mobile`, `apps/web`)** — required on every UI change in those apps.
Read `DESIGN.md` and follow it. It is the source of truth for visual and interaction decisions
(color tokens, type, spacing, shape, screens, copy tone). Reuse its tokens and components.
Open `docs/reference-app.png` and match its look and feel: layout, photography, hierarchy,
warmth, density, and corner treatment. When the written spec and the image disagree on feel,
prefer the image for atmosphere and `DESIGN.md` for tokens and rules. `apps/admin` does not
follow this consumer visual language.

1. **Admin (`apps/admin`)** — always use the **shadcn** skill. Read
   `.agents/skills/shadcn/SKILL.md` before building or changing UI. Use the shadcn
   components in `src/components/ui` (Base UI + Tailwind). Add components with
   `pnpm dlx shadcn@latest add <name> -c apps/admin`. Style with Tailwind utilities and
   the CSS variables in `globals.css`. Do not add Material UI, Emotion, Gluestack, UniWind,
   React Native Paper, or `react-native-web`.

2. **Web (`apps/web`)** — use the shadcn components in `src/components/ui` (Base UI +
   Tailwind). Add components with `pnpm dlx shadcn@latest add <name> -c apps/web`. Style
   with Tailwind utilities and the CSS variables in `globals.css`. Do not add Material UI,
   Emotion, Gluestack, UniWind, React Native Paper, or `react-native-web`. Take color, type,
   spacing, and hierarchy from `DESIGN.md` and `docs/reference-app.png`.

3. **Mobile (`apps/mobile`)** — always use the **expo-ui** skill (and **expo-native-ui** for
   layout/HIG). Read `.agents/skills/expo-ui/SKILL.md` before building or changing UI.
   Prefer `@expo/ui` for sheets, pickers, menus, toggles; SwiftUI (`@expo/ui/swift-ui`) for
   ConfirmationDialog, ContextMenu, DatePicker, Alert/popups (in `src/components/**/*.ios.tsx`,
   never under `app/`). Custom RN components for everything else. Do not use React Native
   Paper or shadcn. Look and feel come from `DESIGN.md` and `docs/reference-app.png`.

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
- **`code-reviewer`** and **`security-auditor`** — launch **in parallel, in one message**, once tests
  pass and the change is ready for review (still do **not** commit unless the user asked). Reviewer
  covers quality/architecture; auditor covers OWASP-class issues, auth gaps, secrets, and the
  data-isolation boundary.
