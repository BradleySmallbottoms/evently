import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CreateSessionRequest,
  CreateSessionResponse,
  ErrorResponse,
} from '@local-events/contracts';
import { authErrorResponse } from '../services/auth/errors';
import type { AuthServices } from '../services/auth/types';

export function registerSessionRoutes(app: OpenAPIHono, auth: AuthServices): void {
  const createSession = createRoute({
    method: 'post',
    path: '/sessions',
    request: {
      body: { content: { 'application/json': { schema: CreateSessionRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'Session issued from device credential',
        content: { 'application/json': { schema: CreateSessionResponse } },
      },
      401: {
        description: 'Invalid device credential',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(createSession, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await auth.createSession(body);
      return c.json(result, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });
}
