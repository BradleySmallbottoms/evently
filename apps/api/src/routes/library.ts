import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CreateEventListRequest,
  ErrorResponse,
  EventIdParam,
  EventListResponse,
  ListEventParams,
  UpdateEventListRequest,
  UserEventList,
  UserEventListResponse,
  IdParam,
} from '@local-events/contracts';
import { readUserSessionToken } from '../services/auth/cookies';
import { libraryErrorResponse } from '../services/library/errors';
import type { LibraryServices } from '../services/library/types';

export function registerLibraryRoutes(app: OpenAPIHono, library: LibraryServices): void {
  const listSaved = createRoute({
    method: 'get',
    path: '/me/saved-events',
    responses: {
      200: {
        description: 'Published events saved by the current user',
        content: { 'application/json': { schema: EventListResponse } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(listSaved, async (c) => {
    try {
      return c.json(await library.listSaved(readUserSessionToken(c)), 200);
    } catch (err) {
      return libraryErrorResponse(c, err);
    }
  });

  const save = createRoute({
    method: 'put',
    path: '/me/saved-events/{eventId}',
    request: { params: EventIdParam },
    responses: {
      204: { description: 'Event saved' },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Event is not published',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(save, async (c) => {
    try {
      const { eventId } = c.req.valid('param');
      await library.saveEvent(readUserSessionToken(c), eventId);
      return c.body(null, 204);
    } catch (err) {
      return libraryErrorResponse(c, err);
    }
  });

  const unsave = createRoute({
    method: 'delete',
    path: '/me/saved-events/{eventId}',
    request: { params: EventIdParam },
    responses: {
      204: { description: 'Event unsaved' },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Save not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(unsave, async (c) => {
    try {
      const { eventId } = c.req.valid('param');
      await library.unsaveEvent(readUserSessionToken(c), eventId);
      return c.body(null, 204);
    } catch (err) {
      return libraryErrorResponse(c, err);
    }
  });

  const listLists = createRoute({
    method: 'get',
    path: '/me/lists',
    responses: {
      200: {
        description: 'Custom lists for the current user',
        content: { 'application/json': { schema: UserEventListResponse } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(listLists, async (c) => {
    try {
      return c.json(await library.listLists(readUserSessionToken(c)), 200);
    } catch (err) {
      return libraryErrorResponse(c, err);
    }
  });

  const createList = createRoute({
    method: 'post',
    path: '/me/lists',
    request: {
      body: { content: { 'application/json': { schema: CreateEventListRequest } }, required: true },
    },
    responses: {
      201: {
        description: 'List created',
        content: { 'application/json': { schema: UserEventList } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      409: {
        description: 'List limit reached',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(createList, async (c) => {
    try {
      const body = c.req.valid('json');
      return c.json(await library.createList(readUserSessionToken(c), body), 201);
    } catch (err) {
      return libraryErrorResponse(c, err);
    }
  });

  const updateList = createRoute({
    method: 'patch',
    path: '/me/lists/{id}',
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: UpdateEventListRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'List renamed',
        content: { 'application/json': { schema: UserEventList } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'List not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(updateList, async (c) => {
    try {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      return c.json(await library.updateList(readUserSessionToken(c), id, body), 200);
    } catch (err) {
      return libraryErrorResponse(c, err);
    }
  });

  const deleteList = createRoute({
    method: 'delete',
    path: '/me/lists/{id}',
    request: { params: IdParam },
    responses: {
      204: { description: 'List deleted' },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'List not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(deleteList, async (c) => {
    try {
      const { id } = c.req.valid('param');
      await library.deleteList(readUserSessionToken(c), id);
      return c.body(null, 204);
    } catch (err) {
      return libraryErrorResponse(c, err);
    }
  });

  const addItem = createRoute({
    method: 'put',
    path: '/me/lists/{id}/events/{eventId}',
    request: { params: ListEventParams },
    responses: {
      204: { description: 'Event added to the list' },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'List or event not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      409: {
        description: 'List item limit reached',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(addItem, async (c) => {
    try {
      const { id, eventId } = c.req.valid('param');
      await library.addListEvent(readUserSessionToken(c), id, eventId);
      return c.body(null, 204);
    } catch (err) {
      return libraryErrorResponse(c, err);
    }
  });

  const removeItem = createRoute({
    method: 'delete',
    path: '/me/lists/{id}/events/{eventId}',
    request: { params: ListEventParams },
    responses: {
      204: { description: 'Event removed from the list' },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'List or item not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(removeItem, async (c) => {
    try {
      const { id, eventId } = c.req.valid('param');
      await library.removeListEvent(readUserSessionToken(c), id, eventId);
      return c.body(null, 204);
    } catch (err) {
      return libraryErrorResponse(c, err);
    }
  });
}
