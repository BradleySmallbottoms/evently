# apps

| App             | Status                  | Port (dev) | Talks to      |
| --------------- | ----------------------- | ---------- | ------------- |
| `api/`          | Skeleton (Hono)         | 13000      | DB, SQS, S3   |
| `admin-api/`    | Skeleton (Hono)         | 13001      | DB, SQS, S3   |
| `worker/`       | Skeleton (SQS handlers) | –          | DB, Expo Push |
| `data-workers/` | One-shot ingest runner  | –          | DB, SQS, S3   |
| `mobile/`       | Scaffolded (Expo)       | 18081      | public API    |

`pnpm dev` starts the long-running apps only (data-workers is excluded — run it with a source
slug when you need a fetch: `pnpm --filter @local-events/data-workers dev -- --source example-fixture`).
| `web/` | Scaffolded (Next.js) | 13100 | public API |
| `admin/` | Scaffolded (Next.js) | 13200 | admin API only |

The three frontends are created with their official scaffolders so they start on current
framework defaults. The steps below were tested inside this monorepo (Expo SDK 57, Next.js 16.4,
pnpm 12). Run every command from the **repo root** unless a step says otherwise.

Rules that apply to all three:

- Package names use the `@local-events/` scope so Turborepo and `pnpm --filter` find them.
- Import shared code only from `@local-events/contracts`, `@local-events/domain` and
  `@local-events/geo` (and later the generated API clients). **Never** import `@local-events/db`,
  `@local-events/auth` or `@local-events/ingest` in a frontend; they are server-only.
- Every app gets a `typecheck` script so `pnpm typecheck` covers it.
- Swedish is the default locale, English the second one.

---

## Mobile app (Expo)

### 1. Scaffold

```bash
cd apps
pnpm create expo-app@latest mobile --template default --no-install
cd ..
rm -rf apps/mobile/.git apps/mobile/LICENSE   # the scaffolder may create a nested git repo
```

`create-expo-app` also writes an `AGENTS.md` (and a small `.claude/settings.json`) into the app.
Keep `AGENTS.md`: it has Expo-specific guidance that complements the root `CLAUDE.md`. Pass
`--no-agents-md` if you don't want them.

### 2. Join the workspace

In `apps/mobile/package.json` set `"name": "@local-events/mobile"` and add scripts:

```json
"scripts": {
  "dev": "expo start --port 18081",
  "typecheck": "tsc --noEmit",
  "lint": "expo lint"
}
```

Then install and add the shared packages:

```bash
pnpm install
pnpm --filter @local-events/mobile add @local-events/contracts@workspace:* @local-events/domain@workspace:* @local-events/geo@workspace:*
```

Create `apps/mobile/expo-env.d.ts` (Expo also generates it on the first `expo start`; without it
`tsc` fails on CSS imports in the template):

```ts
/// <reference types="expo/types" />
```

No Metro or `.npmrc` changes are needed: Metro resolved workspace packages with pnpm's default
layout in testing. If that ever breaks, see the comment in the root `.npmrc` and Expo's
[monorepo guide](https://docs.expo.dev/guides/monorepos/).

### 3. Native modules

```bash
cd apps/mobile
pnpm expo install expo-location expo-notifications expo-secure-store expo-camera expo-task-manager expo-localization react-native-maps
pnpm add @tanstack/react-query i18next react-i18next
cd ../..
```

Add plugins and permission texts to `apps/mobile/app.json` (adjust wording; Swedish first):

```json
{
  "expo": {
    "name": "Local Events",
    "slug": "local-events",
    "scheme": "localevents",
    "ios": { "bundleIdentifier": "se.candybanana.lcly" },
    "android": { "package": "se.candybanana.lcly" },
    "plugins": [
      [
        "expo-location",
        {
          "locationWhenInUsePermission": "Används för att checka in på evenemang och hitta evenemang nära dig."
        }
      ],
      ["expo-camera", { "cameraPermission": "Används för att skanna incheckningskoder." }],
      "expo-notifications",
      "expo-secure-store",
      "expo-localization"
    ]
  }
}
```

Do **not** add background location; v1 is foreground-only (see `docs/project-description.md`).
Ads (`react-native-google-mobile-ads`) are added in Phase 6.

### 4. EAS (builds and store submission)

```bash
cd apps/mobile
pnpm dlx eas-cli@latest login
pnpm dlx eas-cli@latest init
pnpm dlx eas-cli@latest build:configure
```

Create build profiles/channels `development`, `staging`, `production` in `eas.json` to match the
three AWS environments.

### 5. Verify

```bash
pnpm --filter @local-events/mobile typecheck
pnpm --filter @local-events/mobile dev
```

---

## Web app (Next.js)

### 1. Scaffold

```bash
cd apps
pnpm create next-app@latest web --ts --app --src-dir --eslint --import-alias "@/*" --use-pnpm --disable-git --skip-install
cd ..
rm apps/web/pnpm-workspace.yaml   # nested workspace file would split the app off the monorepo
```

The root `pnpm-workspace.yaml` already contains the `allowBuilds` entries (`sharp`,
`unrs-resolver`) that the deleted file held. Keep the generated `AGENTS.md` (Next.js version
guidance).

### 2. Join the workspace

In `apps/web/package.json`:

- set `"name": "@local-events/web"` and remove the `packageManager` field (the root one applies);
- change scripts to:

```json
"scripts": {
  "dev": "next dev -p 13100",
  "build": "next build",
  "start": "next start -p 13100",
  "lint": "eslint",
  "typecheck": "next typegen && tsc --noEmit"
}
```

`next typegen` generates route types (`LayoutProps`, `PageProps`); plain `tsc` fails without it.

Replace `apps/web/next.config.ts` so Next compiles our TypeScript-source packages:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@local-events/contracts', '@local-events/domain', '@local-events/geo'],
};

export default nextConfig;
```

Install and add packages:

```bash
pnpm install
pnpm --filter @local-events/web add @local-events/contracts@workspace:* @local-events/domain@workspace:* @local-events/geo@workspace:* @tanstack/react-query next-intl
```

UI is shadcn/ui (Base UI + Tailwind). Components live in `src/components/ui`. The web
theme tokens in `src/app/[locale]/globals.css` follow `DESIGN.md`. Add a component with
`pnpm dlx shadcn@latest add <name> -c apps/web`.

### 3. Configure

- `apps/web/.env.local`: `NEXT_PUBLIC_API_URL=http://localhost:13000/v1`
- i18n with `next-intl`: locales `sv` (default) and `en`.
- The web app hosts public event pages (SEO), the publisher workspace (email login) and the
  "sign in with the app" pairing page.

### 4. Verify

```bash
pnpm --filter @local-events/web typecheck
pnpm --filter @local-events/web build
```

---

## Admin console (Next.js + shadcn)

### 1. Scaffold

```bash
cd apps
pnpm create next-app@latest admin --ts --app --src-dir --eslint --import-alias "@/*" --use-pnpm --disable-git --skip-install
cd ..
rm apps/admin/pnpm-workspace.yaml
```

### 2. Join the workspace

Same as the web app, with `"name": "@local-events/admin"` and port **13200**
(`next dev -p 13200`, `next start -p 13200`), the same `typecheck` script and the same
`transpilePackages` (admin omits `geo` / `api-client`).

```bash
pnpm install
pnpm --filter @local-events/admin add @local-events/contracts@workspace:* @local-events/domain@workspace:* @tanstack/react-query @tanstack/react-table
```

### 3. shadcn

Admin and web use shadcn/ui (Base UI + Tailwind). Components live in each app's
`src/components/ui`. Admin keeps the neutral theme. Mobile uses custom components plus
`@expo/ui` (and SwiftUI overlays) — do not add shadcn, `react-native-web`, or React Native
Paper to the wrong apps. Follow `.agents/skills/expo-ui/SKILL.md` for mobile.

Component placement (also in `CLAUDE.md`):

- Shared across routes/screens → `src/components/`
- Unique to one route → Next: `app/.../<route>/components/`; Expo: `app/<route>/_components/`
- Before adding a component, reuse or promote an existing one into `src/components/` when it fits
  more than one view. Native/SwiftUI overlays on mobile stay under `src/components/native/`.

### 4. Configure

- `apps/admin/.env.local`: `NEXT_PUBLIC_ADMIN_API_URL=http://localhost:13001/v1`
- The admin app calls the **admin API only**, never the public API.
- In AWS it sits behind the WAF IP allowlist like the admin API.

### 5. Verify

```bash
pnpm --filter @local-events/admin typecheck
pnpm --filter @local-events/admin build
```

---

## After creating the frontends

- Run `pnpm typecheck && pnpm test && pnpm build` from the root.
- Tick the "Create apps/mobile, apps/web, apps/admin" item in `docs/build-plan.md`.
- Public API client: `packages/api-client` (regenerate with `pnpm api-client:generate`). Admin
  client (`packages/admin-client`) is still pending until the admin API has real routes.
- Sentry is wired on all apps; set `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` /
  `EXPO_PUBLIC_SENTRY_DSN` to enable (no-op when unset).
