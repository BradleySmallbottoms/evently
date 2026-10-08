# Build from the repo root: docker build -f apps/admin-api/Dockerfile -t local-events-admin-api .
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @local-events/admin-api build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/admin-api/dist ./dist
USER node
CMD ["node", "--enable-source-maps", "dist/index.js"]
