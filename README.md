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
pnpm install        # also turns on the Prettier pre-commit hook
cp .env.example .env
pnpm db:up          # Postgres + PostGIS + Valkey + ElasticMQ (local SQS) + Garage (local S3)
pnpm db:migrate     # apply packages/db/migrations
pnpm typecheck
pnpm test
pnpm dev            # API :13000, admin-api :13001, web :13100, admin :13200, mobile Metro :18081
```

Useful singles:

```bash
pnpm --filter @local-events/api dev
pnpm --filter @local-events/admin-api dev
pnpm --filter @local-events/web dev
pnpm --filter @local-events/mobile dev
pnpm --filter @local-events/mobile build:development:simulator
pnpm --filter @local-events/data-workers dev -- --source example-fixture
pnpm --filter @local-events/data-workers dev -- --source visit-soderhamn --limit 5
pnpm --filter @local-events/data-workers dev -- --job event-scan
pnpm --filter @local-events/data-workers dev -- --job replay-scan --dry-run
pnpm --filter @local-events/data-workers dev -- --job replay-scan --limit 20
pnpm --filter @local-events/data-workers dev -- --job publisher-scan
pnpm api-client:generate   # after public API OpenAPI changes
```

## Need to know

### Event tips

- Home “Saknar du ett evenemang?” and profile “Mina tips” let a person send a photo or a short
  description. The public API reads it with Anthropic (`ANTHROPIC_API_KEY`; `ANTHROPIC_MODEL`
  defaults to `claude-sonnet-5-5`). This path does not use the Runpod chat. A text tip stays in the
  chat until title, start date, start time, end date, end time, place, price, link, and description
  are filled. Replies stay on the tip until every required fact is filled, and then the transcript
  is read once. A title, place, or description the person types is checked first. Text that is not
  an event is not saved, and the chat shows a warning. The model names the missing fact, and the
  chat shows that control. The chat does not ask for a tag or a category. The model picks tags
  from the catalog, and the confirm screen shows them. A picture is the last question, including
  one already scanned: yes keeps it, and another picture is added to the chat. Every picture is
  checked, and a harmful picture or one above a PG-13 level is refused. When the facts are already
  complete, the new picture finishes the chat. Change can replace the picture too. A picture
  from the first screen is stored in the public assets bucket (Garage locally) and read into the
  same chat. When the facts are complete, the model writes a short summary for the confirm screen.
  A finished tip becomes
  an imported `pending_scan` event on the seeded `user-tips` source, which stays disabled at trust
  `review`, so the regular scan leaves it `in_review` until an admin publishes it. Publishing the
  event marks the tip published. The event
  description is the written description. The chat lines are stored on `meta.tip`, which public
  responses omit. The scan prompt receives those lines along with the written description.
- The user gets a visible push (`kind` `tip_scan`) that ignores quiet hours and the daily cap.
  The wording says the event was added only when the scan published it. An open app hides the
  banner. A published tip opens the thank-you screen, and any other result opens the tip status.
  A tap, including the inbox row, does the same. Public event pages show “Från användartips” from
  `meta.fromUserTip` and do not name who sent it.
- Apply `pnpm db:migrate` so `event_tips` and the `user-tips` source exist. Tip text and photos
  are deleted with the user; the event row stays.
  Flow: [docs/flows/event-tips.md](docs/flows/event-tips.md).

### Event counts

- The Show events button on home categories, calendar filters, and the location menu shows how many
  events that combination will list. `GET /v1/events/count` uses the same filters as the public
  list. The count is a database query for now. The cache plan is in
  [docs/flows/event-counts.md](docs/flows/event-counts.md).

### Publisher import notifications

- Admin edits a publisher at `/publishers/{id}` (name, slug, type, and notification settings).
  Notification settings are **nothing** or a marketing plan. A plan schedules reminders for events
  a script imports for that publisher, and only when the publisher status is **published**. The reminders
  use saved area plus a matching interest (`area_and_tag`) and skip times already in the past.
  A published import (`auto_publish`) is approved immediately. An event still in review is stored
  as `pending` and is not sent until an admin publishes the event, which approves those rows.
  Flow: [docs/flows/publisher-import-notifications.md](docs/flows/publisher-import-notifications.md).

Operational and product facts that bite during local development. **Update this section (and add
a diagram under [`docs/flows/`](docs/flows/README.md) when the feature has complex client→API→DB
calls) in the same change as every new major feature.**

### Visit Söderhamn import

- First external source is the Citybreak API used by Visit Söderhamn. The worker loads the category
  tree, then products in **Evenemang** (category `30172`) only. Each occasion becomes its own event,
  unless the occasions are a dense run of opening hours longer than `occasionSpanDays` (default 21)
  covering at least `occasionCoverage` of those days (default 0.6). Both live on `data_sources.config`.
  A collapsed run is one event with `meta.collapsed` true and every occasion on `meta.occasions`. When two or more occasions stay separate, each event stores the
  product id on `meta.occasionGroupId`. A product with no occasion is still saved, with empty start and end. The mobile event page loads the other published occasions
  in that group from `GET /v1/events/occasions?occasionGroupId=` and lists the ones that have not ended.
  A collapsed span lists each `meta.occasions` row that has not ended on that same page, and the date shown is the next of those rows. The same start and end is a whole day, shown as “Whole Day” through the end of that calendar day.
  A Citybreak time ending in `Z`, or with a numeric offset, is stored as that instant. A time with no zone is Europe/Stockholm. Hälsingland and Hudiksvall date-and-period values are Stockholm wall time too.
  Categories under Evenemang are stored as the tag catalog (`external_id` `visit-soderhamn:{id}`).
  The import does not put those tags on the event. The scan job does. `GET /v1/tags` is that list. The mobile home, calendar, and search call it with
  `?upcoming=true` plus the selected place (`lat`, `lng`, `radiusM`). That keeps tags on a published event that has not ended and sits inside the place. An event without a point does not add a category. Choosing
  preferred tags loads the full list. Publishers and admin do too.
  A fresh database is seeded with the seven tags from the local fixture; a live run adds the rest.
- Set `VISIT_SODERHAMN_API_KEY` before a live run. The key is not stored in `data_sources.config`.
  The seeded row stays **disabled**, so nothing runs it on a timer. A manual run still saves.
  Flow: [docs/flows/visit-soderhamn.md](docs/flows/visit-soderhamn.md).
- `pnpm --filter @local-events/data-workers dev -- --source visit-soderhamn` writes events as
  `pending_scan`. The import scan then puts them `in_review` under a temporary publisher per
  contact email. They do not show up in the public list until an admin publishes them. The same
  run again skips unchanged events.
  Every source also stores http(s) links found in the description (tickets, registration, or info).
  A booking link (`Bokningslänk`) is a `tickets` link. Event links and websites are `info` links.
  Each can appear more than once; every distinct URL is stored. When an occasion's arena has a position, that point is the
  event location. Otherwise the product position is used. Price comes from the Citybreak
  price fields (major units, plus currency), then from gratis or an amount in kr in the
  description. Fri entré with no amount is free. Age limit and accessibility flags that
  are true are stored on `events.meta` (JSON). Every event has that object; it is `{}`
  when there is nothing extra. An event with no price is treated as free in the list
  filter. Cards show a known price as `100kr`.
- Hero images are copied into Garage when `PUBLIC_ASSETS_BUCKET` is set (`pnpm db:up`). The public
  API returns `imageUrl` only when `ASSETS_PUBLIC_BASE_URL` is set. The admin event page shows
  the same hero and gallery. Visit Söderhamn follows each
  event's links (the API links and http(s) links in the description) and reads `og:image` and
  `<img>` URLs. The Citybreak image stays the hero. When it is missing, the hero is the first
  og:image, then the first page image. Further crawled images are stored as `gallery-1`,
  `gallery-2`, and so on. Event payloads return the hero as `imageUrl` and the rest as
  `imageUrls`, in that order. The event screen swipes through them when there is more than one.
  After the first Garage start,
  allow anonymous reads once:
  `docker compose exec garage /garage bucket website --allow local-events-assets`.
  Objects are then `http://local-events-assets.localhost:13902/events/{eventId}/main`.
  A phone running Expo Go cannot open `*.localhost`. The app rewrites those image
  URLs to `GET /v1/assets/…` on the API host, and the API fetches Garage. The phone
  still needs `EXPO_PUBLIC_API_URL` set to this computer's LAN address.
  Browse the buckets at `http://localhost:13909` (Garage Web UI).
  In AWS the same key is served from CloudFront (`ASSETS_PUBLIC_BASE_URL`).

### Glada Hudik import

- Hudiksvall’s public calendar, with no Citybreak API key. The worker reads the unfiltered product
  list (`nodeId` 841) and then each event page. Filtered list queries are left out because
  `robots.txt` disallows them. The page map’s `data-lat` and `data-lng` become the event point.
  A page without a map is saved without a point. The contact address is stored, and the scan
  geocodes a missing point later. A digital showing stays without one.
  Links in the description, information, and contact (including Facebook) are stored. The site
  footer is not. A long daily exhibition becomes one event; a concert or a monthly circle stays
  one event per occasion and stores the product id on `meta.occasionGroupId`. A page with no occasion is still saved, with empty start and end. A collapsed span sets `meta.collapsed` and keeps every occasion on `meta.occasions`. Span length and
  coverage are `occasionSpanDays` and `occasionCoverage` on `data_sources.config` (defaults 21 and 0.6).
  The hero image is the page `og:image`.
  The worker reads the list, then saves each event after its page is ready, before fetching the
  next page. New imports are `pending_scan`. Tag matching, the publisher, and the duplicate check
  run later in the scan job.
  `pnpm --filter @local-events/data-workers dev -- --source glada-hudik` writes `pending_scan` events.
  The seeded row stays disabled. Flow: [docs/flows/glada-hudik.md](docs/flows/glada-hudik.md).

### Import scan

- A scheduled data-worker job claims `pending_scan` events in a batch and hands the event text
  and organizer keys to the prompt runner. The runner loads publisher and duplicate candidates,
  picks the publisher, looks for a duplicate, and asks the configured chat model for up to five
  existing tags. With no `CHAT_PROVIDER`, that is a local
  [Ollama](https://ollama.com) model (`ollama serve`, default `qwen3:8b`). `CHAT_PROVIDER=chatgpt`
  uses `OPENAI_API_KEY` (default `gpt-4.1-mini`). `CHAT_PROVIDER=claude` uses `ANTHROPIC_API_KEY`
  (default `claude-sonnet-5-5`). `CHAT_PROVIDER=runpod` starts a GPU pod
  (`RUNPOD_API_KEY`, `RUNPOD_CHAT_KEY`), serves `Qwen/Qwen3-32B-AWQ` with thinking turned off,
  and scans 25 events at a time on A40s in `CA-MTL-1`. While events are scanning, the job prints once a second how many are in progress, how many are done, and how many have failed. More than one GPU disables vLLM custom all-reduce and NCCL peer access, and a pod started without that is replaced. One A40 holds about 10 full contexts,
  two hold up to 24, and four hold the 25. An H100 or H200 finishes a batch sooner and costs
  more per finished scan. It drains the queue and then stops the pod. A later scan starts that same pod. A start with no free GPU retries until one is free, and the pod stays. The GPU bills only while that pod is running. The model weights stay on a
  network volume named `evnt-scan-models` in `CA-MTL-1`, and that volume keeps billing until it is deleted.
  `EU-SE-1` has no network volumes, so a volume cannot be created there.
  `http` is only allowed on loopback. A scan replaces tags the event already has.
  A later import that sends no tags leaves them in place.
  Importers store the street, postcode, and city on `meta.address`, with the event point when they have one.
  The tool-calling scan opens one https page: the source URL, then a ticket
  link, then an info link, then a Facebook page. A page on visit.destinationhalsingland.se
  is fetched with curl over HTTP/1.1. The model uses that page for tags,
  instructions, the summary, missing dates, and the address. Instructions are visitor
  steps from that page or the description. Tip chat lines, and a step that only asks
  someone to confirm a field, are left out. The model returns that address
  in the scan JSON. A scraped point and address are kept. When the event has no point, the
  scraped address is geocoded, and the model address is used only when the import stored none.
  A street, or a postcode with a city, is geocoded. When that finds nothing, or the address is only a city, the city is geocoded. Only a hit in Sweden is kept.
  The model does not supply coordinates. The model returns possible venue names. Importers leave `events.venue_name` empty and store the name on `meta.import.venueName`. Visit Söderhamn also stores the arena name on `meta.import.arenaName`. The scan prompt passes the arena name, then that venue name, as the location. The highest rank above 80 is written. When the model returns none, the arena name is written, then the imported venue name. A later import does not clear a venue the scan already wrote.
  The worker publishes the event only when the scan approves it, the publisher status is `published`,
  and the source trust is `auto_publish`. Anything else that finishes goes to `in_review`. A model
  failure leaves the row `pending_scan`. A new temporary publisher is `pending_scan`. The event scan does not look it up.
  `pnpm --filter @local-events/data-workers dev -- --job publisher-scan` claims those publishers.
  With `BRAVE_API_KEY` it searches the web, stores the profile on `publishers.meta.lookup`, stores a fetched website as an organizer key, and sets `in_review`.
  A missing key claims nothing. A failed lookup leaves the publisher `pending_scan`. A duplicate ranked over 90 as another showing stores
  `meta.possibleOccasionGroupId` on that event and the matches. An existing `occasionGroupId` is
  reused; otherwise a new id is created. Public responses omit it. `OLLAMA_BASE_URL` must be a loopback URL.
  `OLLAMA_DISABLED=1` skips local Ollama, so an event that still needs tags stays `pending_scan`.
  `pnpm --filter @local-events/data-workers dev -- --job event-scan`
  scans the next batch. Add `--event <event-id>` to scan one row, or `--limit 1` to cap the batch.
  `pnpm --filter @local-events/data-workers dev -- --job replay-scan` reuses stored `events.llm_output`
  and reruns the post-model chain (publisher, duplicate, tags, venue, status, reminders, and publish enqueue)
  without calling a model again. It accepts `--event` and `--limit` too.
  Flow: [docs/flows/event-scan.md](docs/flows/event-scan.md). Publisher lookup: [docs/flows/publisher-scan.md](docs/flows/publisher-scan.md).

### Destination Hälsingland import

- Hälsingland’s public calendar, with no Citybreak API key. The worker calls the JSON the calendar
  page already loads: the event list (`filter=c=4559`, Evenemang i hela Hälsingland), then each
  product’s text and occasions. It does not read HTML. List coordinates are longitude then
  latitude. A product with no coordinate is still saved, without a map point. The list URL is kept
  when it points at another site. Webbsida, Evenemangslänk, and Externa länkar are added when that
  page is not already a link. A product with no venue uses the city after the postcode in Postadress.
  When that line has no city, the town and the list coordinate stay as they are. Gatuadress,
  Postadress, and the list coordinate are stored on `meta.address`. A product
  with no occasion is still saved, with empty start and end. The event scan fills both
  when it can read them from the text. An event with no start stays off the public list. A long daily
  exhibition becomes one event; a concert stays one event per occasion and stores the product id
  on `meta.occasionGroupId`. A collapsed span sets `meta.collapsed` and keeps every occasion on `meta.occasions`. Span length and coverage are `occasionSpanDays` and `occasionCoverage`
  on `data_sources.config` (defaults 21 and 0.6). A lookalike within 200 m
  and 30 minutes is saved as its own review event and flagged in `meta`. That product
  is saved
  before the next product is fetched. Those requests go through `curl` over HTTP/1.1 with
  `PostmanRuntime/2.11.0`. Node's own HTTPS client is answered with a Cloudflare challenge.
  `pnpm --filter @local-events/data-workers dev -- --source destination-halsingland` writes
  `in_review` events. The seeded row stays disabled. Flow:
  [docs/flows/destination-halsingland.md](docs/flows/destination-halsingland.md).
  Later sources and the build order: [docs/event-sources.md](docs/event-sources.md).

### Söderhamns stadsbibliotek import

- The library calendar on soderhamn.se, with no API key. The worker reads the Sitevision list, then
  each event page, and saves that event before the next page is fetched. `robots.txt` disallows
  `jsessionid` URLs, so later pages use `skip` on the clean list URL. Date, time, place, and price
  come from the page. The Sitevision page id is the external id, so two showings of the same title
  stay separate. A date that cannot be read is still saved, with empty start and end. The library
  desk email is the organizer key. The place address is stored. The import does not geocode.
  The scan geocodes a missing point later. Times use the Europe/Stockholm offset.
  `pnpm --filter @local-events/data-workers dev -- --source soderhamn-biblioteket` writes
  `pending_scan` events. The seeded row stays disabled. Flow:
  [docs/flows/soderhamn-biblioteket.md](docs/flows/soderhamn-biblioteket.md).

### Bollnäs kommun import

- The events calendar on bollnas.se, with no API key. The worker reads the Soleil eventsCalendar
  JSON the page already loads (`/appresource/…/items?start=`) and saves each row before the next
  page. `robots.txt` disallows `jsessionid` URLs. Each row is one showing. The item id is the
  external id. A `Z` time is that instant. `freeEntry` `Ja` is free. The place street and city
  are stored on `meta.address`. The import does not geocode. The scan geocodes a missing point
  later. `pnpm --filter @local-events/data-workers dev -- --source bollnas-kommun` writes
  `pending_scan` events. The seeded row stays disabled. Flow:
  [docs/flows/bollnas-kommun.md](docs/flows/bollnas-kommun.md).

### Event share links

- Mobile share uses the OS sheet with `EXPO_PUBLIC_WEB_URL/events/{id}` (default local web
  `http://localhost:13100`). Copy link uses the same URL.
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
  preferred tags, the home page shows a For you carousel of nearby events with any of those tags,
  leaving out events already shown in the featured row. The For you screen still includes them.
  The featured row stays hidden when that page set has no featured events.
  Imports do not write the flag, so a later sync leaves it set. Paid placements (slot, dates, plan
  quota) are still a later feature.
  Flow: [docs/flows/admin-event-edit.md](docs/flows/admin-event-edit.md).

### Saved events, lists, and links

- A save is `PUT /v1/me/saved-events/{eventId}` for the device session. That bookmark is "I'm
  interested." It is not a notification follow (`/me/subscriptions`). "I'm coming" is
  `PUT /v1/me/coming-events/{eventId}` and does not notify anyone. The first insert and a delete
  emit a domain event; the worker updates `numSaved` or `numComing` (lifetime plus calendar
  buckets). `GET /v1/events?sort=popular` orders by those two lifetime counts added together and
  skips a total of 0. Event responses include both counts. Custom lists live at `/v1/me/lists`
  (20 lists, 100 events each). Saves, coming marks, and lists are deleted with the user.
- Tickets and registration are links on the event (`type` `tickets`, `registration`, or `info`).
  Price is optional minor units: missing means unknown, `0` means free.
  A later import that omits price, currency, online URL, or links leaves those fields as they are.
  Flow: [docs/flows/saved-events.md](docs/flows/saved-events.md),
  [docs/flows/event-coming.md](docs/flows/event-coming.md).

### Public events & publishers

- Public `GET /v1/events` only returns **`status = published`** events that have a point inside
  the search radius and have not ended. A whole day, the same start and end, stays through that
  calendar day. An event without a point is left out of the app list and the map. Direct
  lookup by id still returns it. Publishers that are not `published`
  keep their events in `awaiting_verification` until an admin publishes the publisher (which
  releases upcoming events).
- **Push drafts:** publishing creates a `push_messages` row. Trusted publishers auto-approve;
  others need admin approval under **Pushes**. After a send, publishers can **Notify again**
  (`POST /v1/manage/events/{id}/push-message`). Admins can schedule several reminders
  for a published event (`POST /v1/push-messages/event` on the admin API; approved on create).
  A marketing plan on the event page is stored only after approval
  (`POST /v1/push-messages/event-plan`). The publisher still has a single open draft.
  The audience is either anyone whose saved notify area covers the event, or only those whose
  covering area shares a tag with the event. People who follow the publisher are included either
  way. They can also schedule **broadcasts**
  (`POST /v1/push-messages/broadcast`) to everyone or users with a favorite tag. The worker
  sends approved due messages (optional `send_at`); inbox rows appear only then. The event page
  in admin and the publisher event page list messages that are sending or already sent
  (`GET /v1/events/{id}/sent-notifications` on the admin API,
  `GET /v1/manage/events/{id}/sent-notifications` on the public API), with how many people
  got an inbox row. Per-user
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

- First launch shows an **onboarding carousel** (welcome → notifications → location → area →
  tags). Activate requests the OS permission; Skip stores the choice and deferred **reminders**
  reappear after every 5 app activations (one permission at a time). The tags step writes those
  tags as the device home filters (`le.homeTagIds`) and on the area saved in the previous step.
  Each interest card selects that interest’s tags. **Skip** stores an empty selection and turns
  that area’s notifications off. The home list still shows every event. There is
  no account-wide interest list. Reset app data clears the device state.
- Home event queries use **existing** location permission only (no prompt). Check-in and onboarding
  / reminders own the permission request. “Near you” reads that location when the app becomes
  active and watches updates of about 100 m until the app backgrounds. Pull to refresh reads again.
  Background location stays off.
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
  when that credential is missing. Launch and foreground call `POST /v1/sessions`; a rejected
  credential (deleted, revoked, or banned user) shows an alert and, once confirmed, wipes local
  stores and restarts onboarding. Offline does not wipe. Flow:
  [docs/flows/identity-reset.md](docs/flows/identity-reset.md). On the iOS Simulator set
  `EXPO_PUBLIC_API_URL` to
  `http://127.0.0.1:13000/v1` (`localhost` resolves to IPv6 and the request fails). A physical phone
  needs the Mac's LAN address.
- Dev CORS defaults allow web `:13100` and Expo web `:18081` with credentials. Override with
  `CORS_ORIGINS`.
- **Admin console host aliases:** prefer `http://localhost:13200`. Opening via an `/etc/hosts`
  alias requires `ALLOWED_DEV_ORIGINS` (admin Next config) and matching `ADMIN_CORS_ORIGINS`,
  otherwise `/_next` is 403 and the login form appears to do nothing. Session cookies are
  `SameSite=Lax` on the admin API host — keep the UI and `NEXT_PUBLIC_ADMIN_API_URL` on the
  same site (e.g. both `localhost`, or both `*.your-alias`) or the cookie will not stick.
- **Admin queues:** `/review` lists imports in `in_review`, publishers in `in_review`, and `pending`
  notifications (approve/reject). A warning icon marks a row that needs a closer look, such as a
  possible duplicate. Import review and the event catalog can select rows and publish,
  reject, or delete them. Scan again sends an imported review or published event back to `pending_scan`.
  A published event leaves the public list until that scan finishes.
  An event with several occasions, or an `occasionGroupId`, has a Tillfällen tab. Collapse folds the
  checked events into that event and cancels them. Flow:
  [docs/flows/admin-collapse-occasions.md](docs/flows/admin-collapse-occasions.md). Publisher lists can select rows and verify them.
  On `/events/manage`, Ta bort cancels any selected event and keeps the row. Ta bort permanent removes the row and keeps
  the source id out of later imports, and leaves the row when someone has already
  checked in, saved, rated, or been notified. Import review still deletes or wipes an imported event in review
  ([docs/flows/import-review-delete.md](docs/flows/import-review-delete.md)). `/events` redirects there. `/events/manage`
  pages the catalog 50 at a time and searches title, venue, and publisher, then patches status. `/publishers` publishes a publisher, remaps or completes temporary publishers, and shows status.
  A publisher page lists that publisher's events, with ids. Delete is available when the publisher has none.
  The temporary publisher list shows each id, can delete a row that has no events, and can save or verify the checked rows. The verification list and the all-publishers list verify the checked rows. The all-publishers list shows each id
  ([docs/flows/publisher-delete.md](docs/flows/publisher-delete.md)).
  `/moderation` hides ratings and bans users (banned users cannot create sessions or
  use existing ones). `/audit-log` lists admin actions. Ingest raw payloads go to S3 as
  `raw/<source>/<runId>` when `RAW_INGESTION_BUCKET` is set.
- **Data workers:** `pnpm --filter @local-events/data-workers dev -- --source visit-soderhamn`
  (needs `data_sources` row + `VISIT_SODERHAMN_API_KEY`). Add `--limit 5` to stop after that many
  events. The same flag works for every source. Generic ICS calendars use slug
  `ics-feed` with `config.feedUrl` (https). An import with no occasion or no date is still saved, with empty start and end. The event scan fills both when it can read them from the text. An event with no start stays off the public list. A physical import with no venue name stores the city from its scraped address on `meta.import.venueName`. When that address has no city, the point is reverse-geocoded for the nearest city within 25 km. Review-trust sources stay silent until an admin
  publishes from the review queue.

### Preferences (areas)

- Mobile uses `Authorization: Bearer <sessionToken>` on
  `GET/POST/PATCH/DELETE /v1/me/areas` and `GET /v1/me/preferences`.
- Circle areas store `center` + `radius_m`; polygons store geography `area`. Cap 20 areas.
- The location menu always includes “Near you” (device location). Other rows are the user’s
  active saved areas, labeled with the name stored on the area. Each area keeps its own tags
  (`user_area_tags`). Choosing an area shows those tags on home; “Near you” keeps the device
  filters. An empty category list shows every event on home and stores that area’s notifications
  off. Changing tags on home updates the selected area. The search-radius slider is remembered
  per place, on the device and on the user: a saved area stores `search_radius_m`, and “Near you”
  stores `discovery_radius_m`. A new circle starts with `search_radius_m` equal to its
  notification radius. A plus in the menu searches for a
  place (25 km circle) and then asks for the onboarding category groups. Saving or skipping
  with none selected shows the same confirmation as onboarding Skip before that area’s
  notifications are turned off. The save-location prompt asks for those groups after the area
  is created. Flow:
  [docs/flows/user-preferences.md](docs/flows/user-preferences.md).
- **Regions:** `GET /v1/regions/lookup?lat&lng` uses `ST_Covers` on seeded fixtures (Söderhamn
  kommun / Gävleborg län). With no saved region, opening the app looks up that name and asks to
  save it for notifications; a dismiss, including skipping the onboarding area step, waits 7 days near that place, and a place more than about
  25 km away can ask again immediately. The distance is the profile setting “How far can you go”
  (`PUT /v1/me/travel-distance`, default 25 km). Continuing the onboarding area step sets
  that distance to the chosen radius (5, 25, 50, or 100 km); skipping leaves the default.
  The name is the lookup region, then the
  device geocoder. Accept posts `regionId` (or 15 km circle fallback). Declines stay on-device.
  Flow: [docs/flows/region-suggestions.md](docs/flows/region-suggestions.md).

### Push + domain events

- Mobile calls `PUT /v1/me/push-token` with Bearer session + `deviceCredential` + Expo token once
  identity is ready and again after a session refresh. The OS prompt happens only from onboarding
  Activate and reminders. No-op on web, or when permission is still denied.
- Local queues: `pnpm db:up` starts **ElasticMQ** (SQS-compatible) on `:19324` (UI `:19325`). Copy
  `DOMAIN_EVENTS_QUEUE_URL` / `AWS_ENDPOINT_URL_SQS` from `.env.example`. Queue definitions live in
  `infra/local/elasticmq.conf` (add new queues there as consumers appear).
- Publishing a **`published`** event (or admin verify releasing one) enqueues
  `{ type: 'event.published', eventId }` best-effort after the DB write. Without
  `DOMAIN_EVENTS_QUEUE_URL`, APIs keep events in-process and the worker idles.
- Worker fan-out: nearby (covering area ∩ that area’s tags) plus publisher followers on every
  event notification → always insert. Rules: [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md).
  `notifications` inbox row → silent Expo push (data + badge, no alert). The client sets the
  icon badge from that count when the push arrives and clears it when the app becomes active. A banner is a local notification
  the app posts (including while it is open), only outside quiet hours and under the 5/day cap.
  Tapping a notification that carries an event id opens that event. iOS needs
  `enableBackgroundRemoteNotifications` (a new native build) or the background task never runs
  and a banner appears only while the app is open. Inbox list/badge via
  `GET /me/notifications` (`unreadCount`). Rows older than 90 days are purged. Toggle quiet hours
  with `PUT /me/quiet-hours`. Follow via `POST /v1/me/subscriptions`. Needs `DATABASE_URL` on the
  worker. Set `PUSH_DRY_RUN=1` on the worker to keep writing inbox rows and
  `push_message_deliveries` (`status = dry_run`) without POSTing to Expo.
  Flow: [docs/flows/push-and-domain-events.md](docs/flows/push-and-domain-events.md).

### Frontend structure

- Admin/web: **shadcn/ui** only. Mobile: custom UI + `@expo/ui` / SwiftUI overlays (not Paper).
- Shared components → `src/components/`. Route-only → Next `app/.../components/`, Expo
  `app/.../_components/`. Native/SwiftUI overlays stay under `apps/mobile/src/components/native/`.
  Details in `CLAUDE.md`.

### Ports (local)

Host ports are offset so this stack can run next to other Postgres, Valkey, and app
processes. Containers still listen on the image default (the right-hand side of the
compose mapping). `docker compose exec postgres psql` still uses that internal port.
AWS keeps 5432, 6379, 3000, and 3001 inside the VPC.

| Service        | Host port |
| -------------- | --------- |
| API            | 13000     |
| Admin API      | 13001     |
| Web            | 13100     |
| Admin          | 13200     |
| Mobile (Metro) | 18081     |
| E2E API        | 13090     |
| E2E web        | 13190     |
| Postgres       | 15432     |
| Valkey         | 16379     |
| ElasticMQ      | 19324     |
| ElasticMQ UI   | 19325     |
| Garage S3      | 13900     |
| Garage website | 13902     |
| Garage Web UI  | 13909     |

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
- Check-in history: `GET /v1/me/check-ins` returns the newest check-ins for the signed-in user,
  including events that have ended, with each event's publisher and tags.
- **For you** on home uses that history plus the latest saves and "I'm coming" marks, and publishers
  the user follows. It lists upcoming events in the selected area of a similar type, then narrows
  them with any selected home tags. Featured events are left out. The same event can also sit in
  the upcoming list. Flow: [docs/flows/for-you.md](docs/flows/for-you.md).
- Attendee content: publisher CRUD on `/manage/events/{id}/content`; attendees
  `GET /events/{id}/content` (attendee-only rows after check-in). File `s3Key` → short-lived signed
  URL (memory signer in dev). Mobile caches checked-in payloads offline.
  Flow: [docs/flows/attendee-content.md](docs/flows/attendee-content.md).
- Event reports: `POST /events/{id}/reports` with the user session. One row per user and
  published event; a repeat returns the existing report. Admins list them at
  `GET /moderation/event-reports`.
- Ratings: `GET/POST /events/{id}/rating(s)` after check-in from `ends_at` → +14 days. Public
  aggregate only; comments need named profile and appear on
  `GET /manage/events/{id}/ratings`. Flow: [docs/flows/ratings.md](docs/flows/ratings.md).
- Stats: single EAV `stats` table. Worker expands lifetime + day/week/month/year keys and
  always `PUT`s via the API (`STATS_API_URL`/`API_URL` + `STATS_WORKER_TOKEN`) — never
  writes `stats` directly. Nightly `STATS_RECONCILE_MS` (default 24h) resets lifetime keys
  from source tables (reads DB, writes via API). Read via
  `GET /stats/{sourceType}/{sourceId}?key=numCheckins&key=…`. Saves and coming marks use
  `numSaved` and `numComing`. Averages =
  `totalRatingValue / numRatings`. Flow: [docs/flows/stats.md](docs/flows/stats.md).

### E2E vs local data

- Vitest uses in-memory stores — never touches Postgres.
- Playwright (`pnpm test:e2e`) starts its own API/web on **13090/13190** against the disposable
  `events_e2e` database (created by `pnpm db:e2e:setup`). It does **not** reuse `pnpm dev` on
  :13000/:13100, so your day-to-day `events` DB stays clean. Wipe e2e data anytime with
  `docker compose exec postgres psql -U events -c 'DROP DATABASE events_e2e'` then
  `pnpm db:e2e:setup`.

## Scripts

| Command                                | What it does                                                          |
| -------------------------------------- | --------------------------------------------------------------------- |
| `pnpm dev`                             | Runs every app's `dev` task through Turborepo                         |
| `pnpm build`                           | Builds all apps (esbuild bundles for the Node services)               |
| `pnpm typecheck`                       | TypeScript in every workspace                                         |
| `pnpm test`                            | Vitest in every workspace                                             |
| `pnpm db:e2e:setup`                    | Create/migrate disposable `events_e2e` DB for Playwright              |
| `pnpm test:e2e`                        | Playwright smoke against `events_e2e` (ports 13090/13190)             |
| `pnpm format` / `pnpm format:check`    | Prettier. The editor formats on save, and commit formats staged files |
| `pnpm db:up` / `pnpm db:down`          | Start/stop local Postgres, Valkey, ElasticMQ, and Garage              |
| `pnpm db:generate` / `pnpm db:migrate` | Create / apply Drizzle migrations                                     |
| `pnpm api-client:generate`             | Export OpenAPI → `packages/api-client` types                          |

## Repository layout

```
apps/
  api/            Public REST API (Hono + zod-openapi) — mobile + web
  admin-api/      Admin REST API — admin console only
  worker/         SQS consumer: notifications, stats
  data-workers/   Scheduled ingestion, one adapter per source
  mobile/         Expo app
  web/            Next.js public web (shadcn)
  admin/          Next.js admin (shadcn)
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
.agents/skills/   Frontend UI skills (Expo UI, …)
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
