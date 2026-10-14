import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  AdminCompletePublisherRequest,
  AdminCompletePublisherResponse,
  AdminMapPublisherRequest,
  AdminMapPublisherResponse,
  AdminPublisherListResponse,
  AdminPublisherPatchRequest,
  AdminTemporaryPublisherListResponse,
  ErrorResponse,
  PublisherSummaryAdmin,
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
        temporary: z.enum(['true', 'false']).optional(),
        all: z.enum(['true', 'false']).optional(),
      }),
    },
    responses: {
      200: {
        description: 'Publishers (unverified, temporary, or all)',
        content: {
          'application/json': {
            schema: z.union([AdminPublisherListResponse, AdminTemporaryPublisherListResponse]),
          },
        },
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
      const { verified, temporary, all } = c.req.valid('query');
      if (temporary === 'true') {
        return c.json({ items: await publishers.listTemporary() }, 200);
      }
      if (all === 'true') {
        return c.json({ items: await publishers.listAll() }, 200);
      }
      if (verified === 'true') return c.json({ items: [] }, 200);
      return c.json({ items: await publishers.listUnverified() }, 200);
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

  const map = createRoute({
    method: 'post',
    path: '/publishers/{id}/map',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: AdminMapPublisherRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'Temporary publisher remapped; events moved',
        content: { 'application/json': { schema: AdminMapPublisherResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found or not temporary',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(map, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const result = await publishers.mapTo({
        sourcePublisherId: id,
        targetPublisherId: body.targetPublisherId,
        adminId: session.adminId,
      });
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const complete = createRoute({
    method: 'post',
    path: '/publishers/{id}/complete',
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: { 'application/json': { schema: AdminCompletePublisherRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Temporary publisher details completed',
        content: { 'application/json': { schema: AdminCompletePublisherResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found, not temporary, or slug taken',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(complete, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const result = await publishers.complete(c.req.valid('param').id, c.req.valid('json'));
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const getOne = createRoute({
    method: 'get',
    path: '/publishers/{id}',
    request: {
      params: z.object({ id: z.uuid() }),
    },
    responses: {
      200: {
        description: 'Publisher',
        content: { 'application/json': { schema: PublisherSummaryAdmin } },
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
  app.openapi(getOne, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const result = await publishers.get(c.req.valid('param').id);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const patch = createRoute({
    method: 'patch',
    path: '/publishers/{id}',
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: { 'application/json': { schema: AdminPublisherPatchRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Publisher updated',
        content: { 'application/json': { schema: PublisherSummaryAdmin } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found or slug taken',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(patch, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const result = await publishers.patch(c.req.valid('param').id, c.req.valid('json'));
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });
}
