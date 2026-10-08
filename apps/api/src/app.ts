import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { HealthResponse } from '@local-events/contracts';

/**
 * Public API used by the mobile app and web app. Routes are defined with zod-openapi so the
 * OpenAPI spec (served at /v1/openapi.json) can generate the typed client in packages/api-client.
 * Keep handlers thin: validate, call @local-events/domain, persist via @local-events/db.
 */
export function createApp() {
  const app = new OpenAPIHono();

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
    c.json({ status: 'ok' as const, service: 'api', time: new Date().toISOString() }, 200),
  );

  // v1 routes are added here as the build plan progresses, e.g.:
  // POST /v1/identities, POST /v1/web-login, GET /v1/events, POST /v1/events/{id}/check-ins

  app.doc('/v1/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Local Events public API', version: '1.0.0' },
  });

  return app;
}
