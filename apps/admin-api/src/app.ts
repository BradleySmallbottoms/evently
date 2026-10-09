import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { HealthResponse } from '@local-events/contracts';
import { Sentry } from './sentry';

/**
 * Admin API used only by apps/admin. Network-restricted (WAF IP allowlist) and authenticated with admin accounts + TOTP. Routes are defined with zod-openapi so the
 * OpenAPI spec (served at /v1/openapi.json) can generate the typed client in packages/admin-client.
 * Keep handlers thin: validate, call @local-events/domain, persist via @local-events/db.
 */
export function createApp() {
  const app = new OpenAPIHono();

  app.onError((err, c) => {
    Sentry.captureException(err);
    return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
  });

  const health = createRoute({
    method: 'get',
    path: '/health',
    responses: {
      200: {
        description: 'Service is up',
        content: { 'application/json': { schema: HealthResponse } },
      },
    },
  });
  app.openapi(health, (c) =>
    c.json({ status: 'ok' as const, service: 'admin-api', time: new Date().toISOString() }, 200),
  );

  // v1 routes are added here as the build plan progresses, e.g.:
  // GET /v1/publishers?verified=false, POST /v1/publishers/{id}/verify, GET /v1/sources/{id}/runs

  app.doc('/v1/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Local Events admin API', version: '1.0.0' },
  });

  return app;
}
