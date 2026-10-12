import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CreateEventPushMessageRequest,
  ErrorResponse,
  PushMessageStatus,
} from '@local-events/contracts';
import { z } from 'zod';
import { readPublisherSessionToken } from '../services/auth/cookies';
import { eventErrorResponse } from '../services/events/errors';
import type { PublisherPushMessageServices } from '../services/push-messages/publisher';

const IdParam = z.object({ id: z.uuid() });

const PublisherPushMessage = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  status: PushMessageStatus,
  titleSv: z.string(),
  bodySv: z.string(),
  titleEn: z.string(),
  bodyEn: z.string(),
  sendAt: z.iso.datetime().nullable(),
  copyEdited: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export function registerPublisherPushMessageRoutes(
  app: OpenAPIHono,
  pushMessages: PublisherPushMessageServices,
): void {
  const getOpen = createRoute({
    method: 'get',
    path: '/manage/events/{id}/push-message',
    request: { params: IdParam },
    responses: {
      200: {
        description: 'Open push draft, or null fields when none',
        content: {
          'application/json': {
            schema: z.object({ pushMessage: PublisherPushMessage.nullable() }),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(getOpen, async (c) => {
    try {
      const row = await pushMessages.getOpen({
        sessionToken: readPublisherSessionToken(c),
        eventId: c.req.valid('param').id,
      });
      if (!row) return c.json({ pushMessage: null }, 200);
      return c.json(
        {
          pushMessage: {
            id: row.id,
            eventId: row.eventId,
            status: row.status,
            titleSv: row.titleSv,
            bodySv: row.bodySv,
            titleEn: row.titleEn,
            bodyEn: row.bodyEn,
            sendAt: row.sendAt?.toISOString() ?? null,
            copyEdited: row.copyEdited,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          },
        },
        200,
      );
    } catch (err) {
      return eventErrorResponse(c, err);
    }
  });

  const create = createRoute({
    method: 'post',
    path: '/manage/events/{id}/push-message',
    request: {
      params: IdParam,
      body: {
        content: { 'application/json': { schema: CreateEventPushMessageRequest } },
        required: false,
      },
    },
    responses: {
      201: {
        description: 'Created push draft',
        content: { 'application/json': { schema: PublisherPushMessage } },
      },
      400: {
        description: 'Draft already open or invalid',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(create, async (c) => {
    try {
      const body = (c.req.valid('json') ?? {}) as CreateEventPushMessageRequest;
      const row = await pushMessages.create({
        sessionToken: readPublisherSessionToken(c),
        eventId: c.req.valid('param').id,
        body,
      });
      return c.json(
        {
          id: row.id,
          eventId: row.eventId,
          status: row.status,
          titleSv: row.titleSv,
          bodySv: row.bodySv,
          titleEn: row.titleEn,
          bodyEn: row.bodyEn,
          sendAt: row.sendAt?.toISOString() ?? null,
          copyEdited: row.copyEdited,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        },
        201,
      );
    } catch (err) {
      return eventErrorResponse(c, err);
    }
  });
}
