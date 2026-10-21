import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CreateEventContentRequest,
  ErrorResponse,
  EventContentItem,
  EventContentListResponse,
  UpdateEventContentRequest,
} from '@local-events/contracts';
import { z } from 'zod';
import { readPublisherSessionToken, readUserSessionToken } from '../services/auth/cookies';
import { eventContentErrorResponse } from '../services/event-content/errors';
import type { EventContentServices } from '../services/event-content/types';

const EventIdParam = z.object({ eventId: z.uuid() });
const ContentIdParam = z.object({ contentId: z.uuid() });

export function registerEventContentRoutes(app: OpenAPIHono, content: EventContentServices): void {
  const listPublic = createRoute({
    method: 'get',
    path: '/events/{eventId}/content',
    request: { params: EventIdParam },
    responses: {
      200: {
        description: 'Visible content for the event (attendee-only after check-in)',
        content: { 'application/json': { schema: EventContentListResponse } },
      },
      404: {
        description: 'Event not found or not published',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(listPublic, async (c) => {
    try {
      const { eventId } = c.req.valid('param');
      return c.json(await content.listForEvent(readUserSessionToken(c), eventId), 200);
    } catch (err) {
      return eventContentErrorResponse(c, err);
    }
  });

  const listManaged = createRoute({
    method: 'get',
    path: '/manage/events/{eventId}/content',
    request: { params: EventIdParam },
    responses: {
      200: {
        description: 'All content items for the publisher',
        content: {
          'application/json': {
            schema: z.object({ items: z.array(EventContentItem) }),
          },
        },
      },
      401: {
        description: 'Missing publisher session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Not a member',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Event not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(listManaged, async (c) => {
    try {
      const { eventId } = c.req.valid('param');
      return c.json(await content.listManaged(readPublisherSessionToken(c), eventId), 200);
    } catch (err) {
      return eventContentErrorResponse(c, err);
    }
  });

  const create = createRoute({
    method: 'post',
    path: '/manage/events/{eventId}/content',
    request: {
      params: EventIdParam,
      body: {
        content: { 'application/json': { schema: CreateEventContentRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Content created',
        content: { 'application/json': { schema: EventContentItem } },
      },
      401: {
        description: 'Missing publisher session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Not a member',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Event not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(create, async (c) => {
    try {
      const { eventId } = c.req.valid('param');
      const body = c.req.valid('json');
      return c.json(await content.create(readPublisherSessionToken(c), eventId, body), 201);
    } catch (err) {
      return eventContentErrorResponse(c, err);
    }
  });

  const update = createRoute({
    method: 'patch',
    path: '/manage/content/{contentId}',
    request: {
      params: ContentIdParam,
      body: {
        content: { 'application/json': { schema: UpdateEventContentRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Content updated',
        content: { 'application/json': { schema: EventContentItem } },
      },
      401: {
        description: 'Missing publisher session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Not a member',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Content not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(update, async (c) => {
    try {
      const { contentId } = c.req.valid('param');
      const body = c.req.valid('json');
      return c.json(await content.update(readPublisherSessionToken(c), contentId, body), 200);
    } catch (err) {
      return eventContentErrorResponse(c, err);
    }
  });

  const remove = createRoute({
    method: 'delete',
    path: '/manage/content/{contentId}',
    request: { params: ContentIdParam },
    responses: {
      204: { description: 'Deleted' },
      401: {
        description: 'Missing publisher session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Not a member',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Content not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(remove, async (c) => {
    try {
      const { contentId } = c.req.valid('param');
      await content.remove(readPublisherSessionToken(c), contentId);
      return c.body(null, 204);
    } catch (err) {
      return eventContentErrorResponse(c, err);
    }
  });
}
