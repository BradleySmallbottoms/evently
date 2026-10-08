# Build from the repo root: docker build -f apps/api/Dockerfile -t local-events-api .
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @local-events/api build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/api/dist ./dist
USER node
CMD ["node", "--enable-source-maps", "dist/index.js"]
