import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { HealthResponse } from '@local-events/contracts';

export function registerHealthRoutes(app: OpenAPIHono): void {
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
}
