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
# The bundle is ESM. argon2 is a native addon, so it stays outside the bundle.
RUN printf '%s\n' '{"type":"module","dependencies":{"argon2":"0.45.1"}}' > package.json \
  && npm install --omit=dev \
  && chown -R node:node /app
COPY --from=build --chown=node:node /repo/apps/admin-api/dist ./dist
USER node
CMD ["node", "--enable-source-maps", "dist/index.js"]
