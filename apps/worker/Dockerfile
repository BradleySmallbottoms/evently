# Build from the repo root: docker build -f apps/worker/Dockerfile -t local-events-worker .
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @local-events/worker build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/worker/dist ./dist
USER node
CMD ["node", "--enable-source-maps", "dist/index.js"]
