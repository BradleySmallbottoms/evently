import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import {
  ConfirmTipRequest,
  CreateTipRequest,
  ErrorResponse,
  Tip,
  TipIdParam,
  TipImageRequest,
  TipListResponse,
  TipTextRequest,
} from '@local-events/contracts';
import { authErrorResponse } from '../services/auth/errors';
import { readUserSessionToken } from '../services/auth/cookies';
import { TipError, tipErrorResponse } from '../services/tips/errors';
import type { TipServices } from '../services/tips/service';

function fail(c: Parameters<typeof tipErrorResponse>[0], err: unknown) {
  if (err instanceof TipError) return tipErrorResponse(c, err);
  return authErrorResponse(c, err);
}

export function registerTipRoutes(app: OpenAPIHono, tips: TipServices): void {
  app.use(
    '/me/tips/:tipId/images',
    bodyLimit({
      maxSize: 12 * 1024 * 1024,
      onError: (c) => c.json({ error: { code: 'too_large', message: 'Image is too large' } }, 413),
    }),
  );
  const create = createRoute({
    method: 'post',
    path: '/me/tips',
    request: { body: { content: { 'application/json': { schema: CreateTipRequest } } } },
    responses: {
      201: { description: 'Tip started', content: { 'application/json': { schema: Tip } } },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(create, async (c) => {
    try {
      return c.json(await tips.create(readUserSessionToken(c), c.req.valid('json')), 201);
    } catch (err) {
      return fail(c, err);
    }
  });

  const list = createRoute({
    method: 'get',
    path: '/me/tips',
    responses: {
      200: {
        description: 'Tips sent by the current user',
        content: { 'application/json': { schema: TipListResponse } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(list, async (c) => {
    try {
      return c.json(await tips.list(readUserSessionToken(c)), 200);
    } catch (err) {
      return fail(c, err);
    }
  });

  const get = createRoute({
    method: 'get',
    path: '/me/tips/{tipId}',
    request: { params: TipIdParam },
    responses: {
      200: { description: 'One tip', content: { 'application/json': { schema: Tip } } },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Tip not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(get, async (c) => {
    try {
      return c.json(await tips.get(readUserSessionToken(c), c.req.valid('param').tipId), 200);
    } catch (err) {
      return fail(c, err);
    }
  });

  const text = createRoute({
    method: 'post',
    path: '/me/tips/{tipId}/text',
    request: {
      params: TipIdParam,
      body: { content: { 'application/json': { schema: TipTextRequest } } },
    },
    responses: {
      200: {
        description: 'Description read into a card',
        content: { 'application/json': { schema: Tip } },
      },
      400: {
        description: 'Description is empty or longer than 500 characters',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Tip not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      409: {
        description: 'Tip is already submitted',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(text, async (c) => {
    try {
      const { tipId } = c.req.valid('param');
      return c.json(
        await tips.addText(readUserSessionToken(c), tipId, c.req.valid('json').text),
        200,
      );
    } catch (err) {
      return fail(c, err);
    }
  });

  const image = createRoute({
    method: 'post',
    path: '/me/tips/{tipId}/images',
    request: {
      params: TipIdParam,
      body: { content: { 'application/json': { schema: TipImageRequest } } },
    },
    responses: {
      200: {
        description: 'Image stored. Vision keeps running.',
        content: { 'application/json': { schema: Tip } },
      },
      400: {
        description: 'Image is too large or an unsupported type',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Tip not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      409: {
        description: 'Too many images, or the tip is already submitted',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(image, async (c) => {
    try {
      const { tipId } = c.req.valid('param');
      return c.json(await tips.addImage(readUserSessionToken(c), tipId, c.req.valid('json')), 200);
    } catch (err) {
      return fail(c, err);
    }
  });

  const confirm = createRoute({
    method: 'post',
    path: '/me/tips/{tipId}/confirm',
    request: {
      params: TipIdParam,
      body: { content: { 'application/json': { schema: ConfirmTipRequest } } },
    },
    responses: {
      200: {
        description: 'Card accepted, follow-up requested, or the event submitted',
        content: { 'application/json': { schema: Tip } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Tip not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      409: {
        description: 'Daily limit, or the tip cannot be confirmed',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(confirm, async (c) => {
    try {
      const { tipId } = c.req.valid('param');
      return c.json(await tips.confirm(readUserSessionToken(c), tipId, c.req.valid('json')), 200);
    } catch (err) {
      return fail(c, err);
    }
  });

  const remove = createRoute({
    method: 'delete',
    path: '/me/tips/{tipId}',
    request: { params: TipIdParam },
    responses: {
      204: { description: 'Tip deleted. The event created from it stays.' },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Tip not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(remove, async (c) => {
    try {
      await tips.remove(readUserSessionToken(c), c.req.valid('param').tipId);
      return c.body(null, 204);
    } catch (err) {
      return fail(c, err);
    }
  });
}
