import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  AdminEventDecisionResponse,
  AdminEventDeleteResponse,
  AdminEventDetail,
  AdminEventListQuery,
  AdminEventListResponse,
  AdminEventPatchRequest,
  AdminEventReviewListResponse,
  TagListResponse,
  ErrorResponse,
} from '@local-events/contracts';
import { z } from 'zod';
import { readAdminSessionToken } from '../services/auth/cookies';
import { adminAuthErrorResponse } from '../services/auth/errors';
import type { AdminAuthServices } from '../services/auth/types';
import { AdminEventError, type AdminEventServices } from '../services/events';

function eventWriteError(c: Parameters<typeof adminAuthErrorResponse>[0], err: unknown) {
  if (err instanceof AdminEventError) {
    const message =
      err.code === 'online_url_required'
        ? 'Digital events need an online URL'
        : 'Event is not valid';
    return c.json({ error: { code: err.code, message } }, 400);
  }
  return adminAuthErrorResponse(c, err);
}

export function registerAdminEventRoutes(
  app: OpenAPIHono,
  events: AdminEventServices,
  auth: AdminAuthServices,
): void {
  const list = createRoute({
    method: 'get',
    path: '/events',
    request: {
      query: AdminEventListQuery,
    },
    responses: {
      200: {
        description: 'Admin event list (review queue when status=in_review)',
        content: {
          'application/json': {
            schema: z.union([AdminEventReviewListResponse, AdminEventListResponse]),
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
      const query = c.req.valid('query');
      // The review queue pages with sort=created. An unpaged in_review call keeps the review shape.
      const paged =
        query.q !== undefined ||
        c.req.query('limit') !== undefined ||
        c.req.query('offset') !== undefined;
      if (query.status === 'in_review' && !paged) {
        return c.json({ items: await events.listInReview() }, 200);
      }
      return c.json(await events.list(query), 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const tags = createRoute({
    method: 'get',
    path: '/tags',
    responses: {
      200: {
        description: 'Event tags',
        content: { 'application/json': { schema: TagListResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(tags, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      return c.json({ items: await events.listTags() }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const getOne = createRoute({
    method: 'get',
    path: '/events/{id}',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Event detail',
        content: { 'application/json': { schema: AdminEventDetail } },
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
      const item = await events.get(c.req.valid('param').id);
      if (!item) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(item, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const approve = createRoute({
    method: 'post',
    path: '/events/{id}/approve',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Imported event published',
        content: { 'application/json': { schema: AdminEventDecisionResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found or not in review',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(approve, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await events.approve(c.req.valid('param').id, session.adminId);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const reject = createRoute({
    method: 'post',
    path: '/events/{id}/reject',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Imported event cancelled',
        content: { 'application/json': { schema: AdminEventDecisionResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found or not in review',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(reject, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await events.reject(c.req.valid('param').id, session.adminId);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const rescan = createRoute({
    method: 'post',
    path: '/events/{id}/rescan',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Imported event queued for another scan',
        content: { 'application/json': { schema: AdminEventDecisionResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found or not an imported event in review',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(rescan, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await events.rescan(c.req.valid('param').id, session.adminId);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const remove = createRoute({
    method: 'delete',
    path: '/events/{id}',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Imported event cancelled and kept',
        content: { 'application/json': { schema: AdminEventDecisionResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found or not in review',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(remove, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await events.softDelete(c.req.valid('param').id, session.adminId);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const wipe = createRoute({
    method: 'post',
    path: '/events/{id}/wipe',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Imported event removed',
        content: { 'application/json': { schema: AdminEventDeleteResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found, not in review, or someone has already checked in',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(wipe, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await events.wipe(c.req.valid('param').id, session.adminId);
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
    path: '/events/{id}',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: AdminEventPatchRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'Updated event',
        content: { 'application/json': { schema: AdminEventDetail } },
      },
      400: {
        description: 'Invalid event fields',
        content: { 'application/json': { schema: ErrorResponse } },
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
  app.openapi(patch, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await events.patch(
        c.req.valid('param').id,
        c.req.valid('json'),
        session.adminId,
      );
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return eventWriteError(c, err);
    }
  });
}
