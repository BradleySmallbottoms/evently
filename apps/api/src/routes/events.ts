import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CreateEventRequest,
  ErrorResponse,
  EventListResponse,
  EventResponse,
  PublicEventListQuery,
  UpdateEventRequest,
} from '@local-events/contracts';
import { z } from 'zod';
import { readPublisherSessionToken } from '../services/auth/cookies';
import { eventErrorResponse } from '../services/events/errors';
import type { EventServices } from '../services/events/types';

const IdParam = z.object({ id: z.uuid() });
const PublisherIdParam = z.object({ publisherId: z.uuid() });

export function registerEventRoutes(app: OpenAPIHono, events: EventServices): void {
  const listPublisherEvents = createRoute({
    method: 'get',
    path: '/publishers/{publisherId}/events',
    request: { params: PublisherIdParam },
    responses: {
      200: {
        description: 'Events for a publisher (all statuses the member can see)',
        content: { 'application/json': { schema: EventListResponse } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(listPublisherEvents, async (c) => {
    try {
      const { publisherId } = c.req.valid('param');
      const items = await events.listPublisherEvents({
        sessionToken: readPublisherSessionToken(c),
        publisherId,
      });
      return c.json({ items }, 200);
    } catch (err) {
      return eventErrorResponse(c, err);
    }
  });

  const createEvent = createRoute({
    method: 'post',
    path: '/publishers/{publisherId}/events',
    request: {
      params: PublisherIdParam,
      body: { content: { 'application/json': { schema: CreateEventRequest } }, required: true },
    },
    responses: {
      201: {
        description: 'Draft event created',
        content: { 'application/json': { schema: EventResponse } },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(createEvent, async (c) => {
    try {
      const { publisherId } = c.req.valid('param');
      const body = c.req.valid('json');
      const result = await events.createEvent({
        sessionToken: readPublisherSessionToken(c),
        publisherId,
        body,
      });
      return c.json(result, 201);
    } catch (err) {
      return eventErrorResponse(c, err);
    }
  });

  const listPublicEvents = createRoute({
    method: 'get',
    path: '/events',
    request: { query: PublicEventListQuery },
    responses: {
      200: {
        description: 'Published events near a point',
        content: { 'application/json': { schema: EventListResponse } },
      },
    },
  });
  app.openapi(listPublicEvents, async (c) => {
    const query = c.req.valid('query');
    const items = await events.listPublicEvents(query);
    return c.json({ items }, 200);
  });

  const getPublicEvent = createRoute({
    method: 'get',
    path: '/events/{id}',
    request: { params: IdParam },
    responses: {
      200: {
        description: 'Published event',
        content: { 'application/json': { schema: EventResponse } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(getPublicEvent, async (c) => {
    try {
      const { id } = c.req.valid('param');
      const result = await events.getEvent({
        sessionToken: undefined,
        eventId: id,
        publicOnly: true,
      });
      return c.json(result, 200);
    } catch (err) {
      return eventErrorResponse(c, err);
    }
  });

  const getManagedEvent = createRoute({
    method: 'get',
    path: '/manage/events/{id}',
    request: { params: IdParam },
    responses: {
      200: {
        description: 'Event for a publisher member (any status)',
        content: { 'application/json': { schema: EventResponse } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(getManagedEvent, async (c) => {
    try {
      const { id } = c.req.valid('param');
      const result = await events.getEvent({
        sessionToken: readPublisherSessionToken(c),
        eventId: id,
        publicOnly: false,
      });
      return c.json(result, 200);
    } catch (err) {
      return eventErrorResponse(c, err);
    }
  });

  const updateEvent = createRoute({
    method: 'patch',
    path: '/manage/events/{id}',
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: UpdateEventRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'Event updated',
        content: { 'application/json': { schema: EventResponse } },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(updateEvent, async (c) => {
    try {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const result = await events.updateEvent({
        sessionToken: readPublisherSessionToken(c),
        eventId: id,
        body,
      });
      return c.json(result, 200);
    } catch (err) {
      return eventErrorResponse(c, err);
    }
  });

  const publishEvent = createRoute({
    method: 'post',
    path: '/manage/events/{id}/publish',
    request: { params: IdParam },
    responses: {
      200: {
        description: 'Event published (or awaiting_verification)',
        content: { 'application/json': { schema: EventResponse } },
      },
      400: {
        description: 'Cannot publish',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(publishEvent, async (c) => {
    try {
      const { id } = c.req.valid('param');
      const result = await events.publishEvent({
        sessionToken: readPublisherSessionToken(c),
        eventId: id,
      });
      return c.json(result, 200);
    } catch (err) {
      return eventErrorResponse(c, err);
    }
  });

  const cancelEvent = createRoute({
    method: 'post',
    path: '/manage/events/{id}/cancel',
    request: { params: IdParam },
    responses: {
      200: {
        description: 'Event cancelled',
        content: { 'application/json': { schema: EventResponse } },
      },
      400: {
        description: 'Cannot cancel',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(cancelEvent, async (c) => {
    try {
      const { id } = c.req.valid('param');
      const result = await events.cancelEvent({
        sessionToken: readPublisherSessionToken(c),
        eventId: id,
      });
      return c.json(result, 200);
    } catch (err) {
      return eventErrorResponse(c, err);
    }
  });
}
