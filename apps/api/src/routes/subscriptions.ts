import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CreateSubscriptionRequest,
  DeleteSubscriptionParams,
  ErrorResponse,
  Subscription,
  SubscriptionListResponse,
} from '@local-events/contracts';
import { readUserSessionToken } from '../services/auth/cookies';
import { subscriptionErrorResponse } from '../services/subscriptions/errors';
import type { SubscriptionServices } from '../services/subscriptions/types';

export function registerSubscriptionRoutes(
  app: OpenAPIHono,
  subscriptions: SubscriptionServices,
): void {
  const list = createRoute({
    method: 'get',
    path: '/me/subscriptions',
    responses: {
      200: {
        description: 'Publisher and event follows for the current user',
        content: { 'application/json': { schema: SubscriptionListResponse } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(list, async (c) => {
    try {
      return c.json(await subscriptions.list(readUserSessionToken(c)), 200);
    } catch (err) {
      return subscriptionErrorResponse(c, err);
    }
  });

  const create = createRoute({
    method: 'post',
    path: '/me/subscriptions',
    request: {
      body: {
        content: { 'application/json': { schema: CreateSubscriptionRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Subscription created (or already present)',
        content: { 'application/json': { schema: Subscription } },
      },
      400: {
        description: 'Unknown publisher or unpublished event',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(create, async (c) => {
    try {
      const body = c.req.valid('json');
      return c.json(await subscriptions.create(readUserSessionToken(c), body), 201);
    } catch (err) {
      return subscriptionErrorResponse(c, err);
    }
  });

  const remove = createRoute({
    method: 'delete',
    path: '/me/subscriptions/{targetType}/{targetId}',
    request: { params: DeleteSubscriptionParams },
    responses: {
      204: { description: 'Subscription removed' },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Subscription not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(remove, async (c) => {
    try {
      const { targetType, targetId } = c.req.valid('param');
      await subscriptions.remove(readUserSessionToken(c), targetType, targetId);
      return c.body(null, 204);
    } catch (err) {
      return subscriptionErrorResponse(c, err);
    }
  });
}
