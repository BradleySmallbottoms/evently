---
name: scaffold-frontend
description: Create the Expo mobile app (apps/mobile), the Next.js web app (apps/web) or the Next.js admin console (apps/admin) inside this monorepo and wire it into pnpm/Turborepo. Use this whenever the user asks to create, scaffold, set up, bootstrap or initialize the mobile app, the app, the web app, the website, the admin, the admin panel or any frontend, even if they don't name Expo or Next.js.
---

# Scaffold a frontend app

The exact, tested commands are in `apps/README.md`. Read the section for the app being created
and follow it step by step; this skill lists what to check so nothing is missed.

## Before starting

1. Confirm the app does not already exist (`ls apps`).
2. Run from the repo root; `pnpm install` must already succeed.

## Checklist per app

All three:

- [ ] Scaffolded with the official CLI (`create-expo-app` / `create-next-app`) using the flags in `apps/README.md`
- [ ] Nested leftovers removed: `apps/<app>/.git` and `LICENSE` (Expo), `apps/<app>/pnpm-workspace.yaml` (Next.js)
- [ ] `name` is `@local-events/<app>`; `packageManager` field removed from the app's package.json
- [ ] Scripts: `dev`, `build` (Next.js), `lint`, `typecheck`
- [ ] Workspace deps added with `@workspace:*`: `contracts`, `domain` (+ `geo` for mobile/web)
- [ ] No imports of `@local-events/db`, `auth` or `ingest` (server-only)
- [ ] i18n set up with `sv` default and `en`
- [ ] `pnpm --filter @local-events/<app> typecheck` passes, then root `pnpm typecheck && pnpm test`

Mobile (Expo):

- [ ] `expo-env.d.ts` with `/// <reference types="expo/types" />`
- [ ] Native modules installed with `pnpm expo install` (location, notifications, secure-store, camera, task-manager, localization, maps)
- [ ] `app.json` plugins with "while in use" location and camera permission texts; **no background location**
- [ ] EAS initialised; build profiles `development`, `staging`, `production`

Web / Admin (Next.js):

- [ ] `typecheck` is `next typegen && tsc --noEmit`
- [ ] `next.config.ts` has `transpilePackages` for every `@local-events/*` package imported
- [ ] Ports: web 13100, admin 13200 (API 13000, admin API 13001, Metro 18081)
- [ ] Admin: shadcn/ui; talks **only** to the admin API (`NEXT_PUBLIC_ADMIN_API_URL`)
- [ ] Web: shadcn/ui; mobile: custom UI + `@expo/ui` / SwiftUI overlays (not Paper)
- [ ] Component placement: shared in `src/components/`; route-only in
      `app/.../components/` (Next) or `app/.../_components/` (Expo); see `CLAUDE.md`

## Afterwards

- Tick the item in `docs/build-plan.md` (Phase 1).
- Update the status table at the top of `apps/README.md`.
