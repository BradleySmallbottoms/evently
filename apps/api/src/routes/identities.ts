import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CreateIdentityRequest,
  CreateIdentityResponse,
  ErrorResponse,
} from '@local-events/contracts';
import type { AuthServices } from '../services/auth/types';

export function registerIdentityRoutes(app: OpenAPIHono, auth: AuthServices): void {
  const createIdentity = createRoute({
    method: 'post',
    path: '/identities',
    request: {
      body: { content: { 'application/json': { schema: CreateIdentityRequest } }, required: true },
    },
    responses: {
      201: {
        description: 'Anonymous identity created',
        content: { 'application/json': { schema: CreateIdentityResponse } },
      },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(createIdentity, async (c) => {
    const body = c.req.valid('json');
    const result = await auth.createIdentity(body);
    return c.json(result, 201);
  });
}
