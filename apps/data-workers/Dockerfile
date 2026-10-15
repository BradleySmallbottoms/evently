# Build from the repo root: docker build -f apps/data-workers/Dockerfile -t local-events-data-workers .
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @local-events/data-workers build

FROM node:24-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/data-workers/dist ./dist
USER node
CMD ["node", "--enable-source-maps", "dist/index.js"]
