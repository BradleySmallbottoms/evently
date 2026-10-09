import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  ErrorResponse,
  LoginPublisherRequest,
  LoginPublisherResponse,
  PublisherMeResponse,
  RegisterPublisherRequest,
  RegisterPublisherResponse,
  VerifyPublisherEmailRequest,
  VerifyPublisherEmailResponse,
} from '@local-events/contracts';
import {
  clearPublisherSessionCookie,
  readPublisherSessionToken,
  setPublisherSessionCookie,
} from '../services/auth/cookies';
import { authErrorResponse } from '../services/auth/errors';
import type { AuthServices } from '../services/auth/types';

export function registerPublisherRoutes(app: OpenAPIHono, auth: AuthServices): void {
  const registerPublisher = createRoute({
    method: 'post',
    path: '/publishers/register',
    request: {
      body: {
        content: { 'application/json': { schema: RegisterPublisherRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Publisher account created; email verification required before login',
        content: { 'application/json': { schema: RegisterPublisherResponse } },
      },
      409: {
        description: 'Email or slug already taken',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(registerPublisher, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await auth.registerPublisher(body);
      return c.json(result, 201);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });

  const verifyPublisherEmail = createRoute({
    method: 'post',
    path: '/publishers/verify-email',
    request: {
      body: {
        content: { 'application/json': { schema: VerifyPublisherEmailRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Email verified',
        content: { 'application/json': { schema: VerifyPublisherEmailResponse } },
      },
      400: {
        description: 'Invalid or expired token',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(verifyPublisherEmail, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await auth.verifyPublisherEmail(body);
      return c.json(result, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });

  const loginPublisher = createRoute({
    method: 'post',
    path: '/publishers/login',
    request: {
      body: { content: { 'application/json': { schema: LoginPublisherRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'Logged in; session cookie set',
        content: { 'application/json': { schema: LoginPublisherResponse } },
      },
      401: {
        description: 'Invalid credentials',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Email not verified',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(loginPublisher, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await auth.loginPublisher(body);
      setPublisherSessionCookie(c, result.sessionToken, result.expiresAt);
      return c.json(result.body, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });

  const logoutPublisher = createRoute({
    method: 'post',
    path: '/publishers/logout',
    responses: {
      204: { description: 'Logged out' },
    },
  });
  app.openapi(logoutPublisher, async (c) => {
    await auth.logoutPublisher(readPublisherSessionToken(c));
    clearPublisherSessionCookie(c);
    return c.body(null, 204);
  });

  const publisherMe = createRoute({
    method: 'get',
    path: '/publishers/me',
    responses: {
      200: {
        description: 'Current publisher account',
        content: { 'application/json': { schema: PublisherMeResponse } },
      },
      401: {
        description: 'Not authenticated',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(publisherMe, async (c) => {
    try {
      const result = await auth.getPublisherMe(readPublisherSessionToken(c));
      return c.json(result, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });
}
