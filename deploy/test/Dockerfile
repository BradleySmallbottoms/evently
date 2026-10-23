# Shared image build for the single-instance test server.
# Context is the repo root. One install is reused across targets.
#
#   docker build -f deploy/test/Dockerfile --target api -t local-events-test-api .

FROM node:24-slim AS deps
WORKDIR /repo
RUN corepack enable
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile

FROM deps AS build-api
RUN pnpm --filter @local-events/api build

FROM deps AS build-admin-api
RUN pnpm --filter @local-events/admin-api build

FROM deps AS build-worker
RUN pnpm --filter @local-events/worker build

FROM deps AS build-data-workers
RUN pnpm --filter @local-events/data-workers build

FROM deps AS build-web
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN pnpm --filter @local-events/web build

FROM deps AS build-admin
ARG NEXT_PUBLIC_ADMIN_API_URL
ENV NEXT_PUBLIC_ADMIN_API_URL=$NEXT_PUBLIC_ADMIN_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN pnpm --filter @local-events/admin build

FROM node:24-slim AS migrate
WORKDIR /app
RUN printf '%s\n' '{"type":"module","dependencies":{"postgres":"3.4.9"}}' > package.json \
  && npm install --omit=dev
COPY --chown=node:node packages/db/scripts ./scripts
COPY --chown=node:node packages/db/migrations ./migrations
RUN chown -R node:node /app
USER node
CMD ["node", "scripts/migrate.mjs"]

FROM node:24-slim AS api
WORKDIR /app
ENV NODE_ENV=production
RUN printf '%s\n' '{"type":"module","dependencies":{"argon2":"0.45.1"}}' > package.json \
  && npm install --omit=dev \
  && chown -R node:node /app
COPY --from=build-api --chown=node:node /repo/apps/api/dist ./dist
USER node
EXPOSE 13000
CMD ["node", "--enable-source-maps", "dist/index.js"]

FROM node:24-slim AS admin-api
WORKDIR /app
ENV NODE_ENV=production
RUN printf '%s\n' '{"type":"module","dependencies":{"argon2":"0.45.1"}}' > package.json \
  && npm install --omit=dev \
  && chown -R node:node /app
COPY --from=build-admin-api --chown=node:node /repo/apps/admin-api/dist ./dist
USER node
EXPOSE 13001
CMD ["node", "--enable-source-maps", "dist/index.js"]

FROM node:24-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN printf '%s\n' '{"type":"module"}' > package.json && chown node:node package.json
COPY --from=build-worker --chown=node:node /repo/apps/worker/dist ./dist
USER node
CMD ["node", "--enable-source-maps", "dist/index.js"]

FROM node:24-slim AS data-workers
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
RUN printf '%s\n' '{"type":"module"}' > package.json && chown node:node package.json
COPY --from=build-data-workers --chown=node:node /repo/apps/data-workers/dist ./dist
USER node
CMD ["node", "--enable-source-maps", "dist/index.js"]

FROM node:24-slim AS web
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=13100
ENV HOSTNAME=0.0.0.0
COPY --from=build-web /repo/apps/web/.next/standalone ./
COPY --from=build-web /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build-web /repo/apps/web/public ./apps/web/public
RUN chown -R node:node /app
USER node
EXPOSE 13100
CMD ["node", "apps/web/server.js"]

FROM node:24-slim AS admin
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=13200
ENV HOSTNAME=0.0.0.0
COPY --from=build-admin /repo/apps/admin/.next/standalone ./
COPY --from=build-admin /repo/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build-admin /repo/apps/admin/public ./apps/admin/public
RUN chown -R node:node /app
USER node
EXPOSE 13200
CMD ["node", "apps/admin/server.js"]
