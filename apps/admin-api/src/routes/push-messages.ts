import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  ApprovePushMessageRequest,
  CreateAdminEventPushMessageRequest,
  CreateBroadcastPushMessageRequest,
  ErrorResponse,
  PushMessage,
  PushMessageAudience,
  PushMessageListResponse,
  SentEventNotificationListResponse,
  UpdatePushMessageRequest,
} from '@local-events/contracts';
import { z } from 'zod';
import { readAdminSessionToken } from '../services/auth/cookies';
import { adminAuthErrorResponse } from '../services/auth/errors';
import type { AdminAuthServices } from '../services/auth/types';
import type { AdminPushMessageServices } from '../services/push-messages';

export function registerPushMessageRoutes(
  app: OpenAPIHono,
  pushMessages: AdminPushMessageServices,
  auth: AdminAuthServices,
): void {
  const list = createRoute({
    method: 'get',
    path: '/push-messages',
    request: {
      query: z.object({
        status: z
          .enum(['pending', 'approved', 'sending', 'sent', 'rejected', 'cancelled'])
          .optional(),
      }),
    },
    responses: {
      200: {
        description: 'Push message drafts',
        content: { 'application/json': { schema: PushMessageListResponse } },
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
      const status = c.req.valid('query').status;
      return c.json({ items: await pushMessages.list(status) }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const listSentForEvent = createRoute({
    method: 'get',
    path: '/events/{id}/sent-notifications',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Push messages sent or currently sending for this event',
        content: { 'application/json': { schema: SentEventNotificationListResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(listSentForEvent, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      return c.json(
        { items: await pushMessages.listSentForEvent(c.req.valid('param').id) },
        200,
      );
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const get = createRoute({
    method: 'get',
    path: '/push-messages/{id}',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Push message',
        content: { 'application/json': { schema: PushMessage } },
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
  app.openapi(get, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const row = await pushMessages.get(c.req.valid('param').id);
      if (!row) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(row, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const audience = createRoute({
    method: 'get',
    path: '/push-messages/{id}/audience',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Estimated recipients',
        content: { 'application/json': { schema: PushMessageAudience } },
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
  app.openapi(audience, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const row = await pushMessages.audience(c.req.valid('param').id);
      if (!row) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(row, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const update = createRoute({
    method: 'patch',
    path: '/push-messages/{id}',
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: { 'application/json': { schema: UpdatePushMessageRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: PushMessage } },
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
  app.openapi(update, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const row = await pushMessages.update(c.req.valid('param').id, c.req.valid('json'));
      if (!row) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(row, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const approve = createRoute({
    method: 'post',
    path: '/push-messages/{id}/approve',
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: { 'application/json': { schema: ApprovePushMessageRequest } },
        required: false,
      },
    },
    responses: {
      200: {
        description: 'Approved',
        content: { 'application/json': { schema: PushMessage } },
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
  app.openapi(approve, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const body = (c.req.valid('json') ?? {}) as ApprovePushMessageRequest;
      const row = await pushMessages.approve(c.req.valid('param').id, body, session.adminId);
      if (!row) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(row, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const reject = createRoute({
    method: 'post',
    path: '/push-messages/{id}/reject',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Rejected',
        content: { 'application/json': { schema: PushMessage } },
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
  app.openapi(reject, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const row = await pushMessages.reject(c.req.valid('param').id);
      if (!row) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(row, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const createBroadcast = createRoute({
    method: 'post',
    path: '/push-messages/broadcast',
    request: {
      body: {
        content: { 'application/json': { schema: CreateBroadcastPushMessageRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Broadcast created and approved',
        content: { 'application/json': { schema: PushMessage } },
      },
      400: {
        description: 'Invalid audience',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(createBroadcast, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const body = c.req.valid('json');
      try {
        const row = await pushMessages.createBroadcast(body, session.adminId);
        return c.json(row, 201);
      } catch (err) {
        if (err instanceof Error && err.message === 'invalid_tag') {
          return c.json({ error: { code: 'invalid_tag', message: 'Unknown tag' } }, 400);
        }
        throw err;
      }
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const createEventPush = createRoute({
    method: 'post',
    path: '/push-messages/event',
    request: {
      body: {
        content: { 'application/json': { schema: CreateAdminEventPushMessageRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Event notification created and approved',
        content: { 'application/json': { schema: PushMessage } },
      },
      400: {
        description: 'Event is not published',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Event not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      409: {
        description: 'An open notification already exists for this event',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(createEventPush, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const body = c.req.valid('json');
      try {
        const row = await pushMessages.createEventPush(body, session.adminId);
        return c.json(row, 201);
      } catch (err) {
        if (err instanceof Error && err.message === 'event_not_found') {
          return c.json({ error: { code: 'event_not_found', message: 'Event not found' } }, 404);
        }
        if (err instanceof Error && err.message === 'event_not_published') {
          return c.json(
            { error: { code: 'event_not_published', message: 'Event must be published' } },
            400,
          );
        }
        if (err instanceof Error && err.message === 'push_draft_exists') {
          return c.json(
            {
              error: {
                code: 'push_draft_exists',
                message: 'An open notification already exists for this event',
              },
            },
            409,
          );
        }
        throw err;
      }
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });
}
