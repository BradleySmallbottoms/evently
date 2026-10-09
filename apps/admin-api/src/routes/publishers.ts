import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  AdminPublisherListResponse,
  ErrorResponse,
  VerifyPublisherResponse,
} from '@local-events/contracts';
import { z } from 'zod';
import type { AdminPublisherServices } from '../services/publishers';

export function registerPublisherRoutes(
  app: OpenAPIHono,
  publishers: AdminPublisherServices,
): void {
  const list = createRoute({
    method: 'get',
    path: '/publishers',
    request: {
      query: z.object({
        verified: z.enum(['true', 'false']).optional(),
      }),
    },
    responses: {
      200: {
        description: 'Publishers',
        content: { 'application/json': { schema: AdminPublisherListResponse } },
      },
    },
  });
  app.openapi(list, async (c) => {
    const { verified } = c.req.valid('query');
    if (verified === 'true') return c.json({ items: [] }, 200);
    const items = await publishers.listUnverified();
    return c.json({ items }, 200);
  });

  const verify = createRoute({
    method: 'post',
    path: '/publishers/{id}/verify',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Publisher verified; upcoming awaiting events released',
        content: { 'application/json': { schema: VerifyPublisherResponse } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(verify, async (c) => {
    const { id } = c.req.valid('param');
    const result = await publishers.verify(id);
    if (!result) {
      return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    }
    return c.json(result, 200);
  });
}
