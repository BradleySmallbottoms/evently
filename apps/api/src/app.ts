import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import {
  CreateIdentityRequest,
  CreateIdentityResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  ErrorResponse,
  HealthResponse,
  LoginPublisherRequest,
  LoginPublisherResponse,
  PublisherMeResponse,
  RegisterPublisherRequest,
  RegisterPublisherResponse,
  VerifyPublisherEmailRequest,
  VerifyPublisherEmailResponse,
} from '@local-events/contracts';
import { cors } from 'hono/cors';
import {
  clearPublisherSessionCookie,
  readPublisherSessionToken,
  setPublisherSessionCookie,
} from './auth/cookies';
import { authErrorResponse } from './auth/errors';
import { createMemoryAuthServices } from './auth/memory';
import type { AuthServices } from './auth/types';
import { Sentry } from './sentry';

export type CreateAppOptions = {
  auth?: AuthServices;
  /**
   * Origins allowed for credentialed CORS (web publisher login).
   * Pass a string list, or a function that returns the reflected Origin (never bare `*`).
   */
  corsOrigin?:
    | string
    | string[]
    | ((origin: string) => string | null | undefined | Promise<string | null | undefined>);
};

/**
 * Public API used by the mobile app and web app. Routes are defined with zod-openapi so the
 * OpenAPI spec (served at /v1/openapi.json) can generate the typed client in packages/api-client.
 * Keep handlers thin: validate, call @local-events/domain, persist via @local-events/db.
 */
export function createApp(options: CreateAppOptions = {}) {
  const auth = options.auth ?? createMemoryAuthServices();
  const app = new OpenAPIHono();

  app.onError((err, c) => {
    Sentry.captureException(err);
    return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
  });

  app.use(
    '*',
    cors({
      origin: options.corsOrigin ?? [
        'http://localhost:3100',
        'http://127.0.0.1:3100',
        'http://localhost:8081',
        'http://127.0.0.1:8081',
      ],
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  const health = createRoute({
    method: 'get',
    path: '/health',
    responses: {
      200: {
        description: 'Service is up',
        content: { 'application/json': { schema: HealthResponse } },
      },
    },
  });
  app.openapi(health, (c) =>
    c.json({ status: 'ok' as const, service: 'api', time: new Date().toISOString() }, 200),
  );

  const createIdentity = createRoute({
    method: 'post',
    path: '/v1/identities',
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

  const createSession = createRoute({
    method: 'post',
    path: '/v1/sessions',
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

  const registerPublisher = createRoute({
    method: 'post',
    path: '/v1/publishers/register',
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
    path: '/v1/publishers/verify-email',
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
    path: '/v1/publishers/login',
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
    path: '/v1/publishers/logout',
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
    path: '/v1/publishers/me',
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

  app.doc('/v1/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Local Events public API', version: '1.0.0' },
  });

  return app;
}
