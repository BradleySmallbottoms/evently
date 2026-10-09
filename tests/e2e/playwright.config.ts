import { defineConfig } from '@playwright/test';

/**
 * E2E uses a disposable Postgres DB (`events_e2e`) and dedicated ports so it never
 * writes into the `events` database that `pnpm dev` uses — even when that stack is
 * already running.
 *
 * Override with E2E_DATABASE_URL / E2E_API_PORT / E2E_WEB_PORT if needed.
 * Set E2E_REUSE_SERVER=1 only if you intentionally want to hit an already-running
 * e2e stack on those ports.
 */
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://events:events@localhost:5432/events_e2e';
const E2E_API_PORT = process.env.E2E_API_PORT ?? '3090';
const E2E_WEB_PORT = process.env.E2E_WEB_PORT ?? '3190';
const E2E_API_ORIGIN = `http://localhost:${E2E_API_PORT}`;
const E2E_WEB_ORIGIN = `http://localhost:${E2E_WEB_PORT}`;
const reuse = process.env.E2E_REUSE_SERVER === '1';

process.env.E2E_API_ORIGIN = E2E_API_ORIGIN;
process.env.E2E_WEB_ORIGIN = E2E_WEB_ORIGIN;

export default defineConfig({
  testDir: '.',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: E2E_WEB_ORIGIN,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `pnpm --filter @local-events/api exec tsx --env-file=../../.env src/index.ts`,
      url: `${E2E_API_ORIGIN}/health`,
      reuseExistingServer: reuse,
      timeout: 120_000,
      env: {
        ...process.env,
        DATABASE_URL: E2E_DATABASE_URL,
        API_PORT: E2E_API_PORT,
        // Avoid SQS / durable side effects during smoke tests.
        DOMAIN_EVENTS_QUEUE_URL: '',
        CORS_ORIGINS: `${E2E_WEB_ORIGIN},http://127.0.0.1:${E2E_WEB_PORT}`,
        INCLUDE_VERIFICATION_TOKEN: 'true',
      },
    },
    {
      command: `pnpm --filter @local-events/web exec next dev --port ${E2E_WEB_PORT}`,
      url: E2E_WEB_ORIGIN,
      reuseExistingServer: reuse,
      timeout: 180_000,
      env: {
        ...process.env,
        PORT: E2E_WEB_PORT,
        NEXT_PUBLIC_API_URL: `${E2E_API_ORIGIN}/v1`,
      },
    },
  ],
});
