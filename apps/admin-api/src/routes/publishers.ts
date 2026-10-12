import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  AdminPublisherListResponse,
  ErrorResponse,
  VerifyPublisherResponse,
} from '@local-events/contracts';
import { z } from 'zod';
import { readAdminSessionToken } from '../services/auth/cookies';
import { adminAuthErrorResponse } from '../services/auth/errors';
import type { AdminAuthServices } from '../services/auth/types';
import type { AdminPublisherServices } from '../services/publishers';

export function registerPublisherRoutes(
  app: OpenAPIHono,
  publishers: AdminPublisherServices,
  auth: AdminAuthServices,
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
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(list, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const { verified } = c.req.valid('query');
      if (verified === 'true') return c.json({ items: [] }, 200);
      const items = await publishers.listUnverified();
      return c.json({ items }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
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
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(verify, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const { id } = c.req.valid('param');
      const result = await publishers.verify(id);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });
}
