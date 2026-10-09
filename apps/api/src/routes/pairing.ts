import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  ConfirmDeviceLinkRequest,
  ConfirmDeviceLinkResponse,
  CreateDeviceLinkCodeRequest,
  CreateDeviceLinkCodeResponse,
  CreateWebLoginCodeRequest,
  CreateWebLoginCodeResponse,
  ErrorResponse,
  ExchangeWebLoginCodeRequest,
  ExchangeWebLoginCodeResponse,
  WebUserMeResponse,
} from '@local-events/contracts';
import {
  clearAppUserSessionCookie,
  readAppUserSessionToken,
  setAppUserSessionCookie,
} from '../services/auth/cookies';
import { authErrorResponse } from '../services/auth/errors';
import type { AuthServices } from '../services/auth/types';

export function registerPairingRoutes(app: OpenAPIHono, auth: AuthServices): void {
  const createCode = createRoute({
    method: 'post',
    path: '/pairing/code',
    request: {
      body: { content: { 'application/json': { schema: CreateWebLoginCodeRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'One-time pairing code for web login',
        content: { 'application/json': { schema: CreateWebLoginCodeResponse } },
      },
      401: {
        description: 'Invalid device credential',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(createCode, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await auth.createWebLoginCode(body);
      return c.json(result, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });

  const exchangeCode = createRoute({
    method: 'post',
    path: '/pairing/login',
    request: {
      body: { content: { 'application/json': { schema: ExchangeWebLoginCodeRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'Web user session created from pairing code',
        content: { 'application/json': { schema: ExchangeWebLoginCodeResponse } },
      },
      401: {
        description: 'Invalid or expired pairing code',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(exchangeCode, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await auth.exchangeWebLoginCode(body);
      setAppUserSessionCookie(c, result.sessionToken, result.expiresAt);
      return c.json(result.body, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });

  const me = createRoute({
    method: 'get',
    path: '/pairing/me',
    responses: {
      200: {
        description: 'Current app user authenticated on web by pairing code',
        content: { 'application/json': { schema: WebUserMeResponse } },
      },
      401: {
        description: 'Not authenticated',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(me, async (c) => {
    try {
      const result = await auth.getWebUserMe(readAppUserSessionToken(c));
      return c.json(result, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });

  const logout = createRoute({
    method: 'post',
    path: '/pairing/logout',
    responses: { 204: { description: 'Logged out web paired session' } },
  });
  app.openapi(logout, async (c) => {
    clearAppUserSessionCookie(c);
    return c.body(null, 204);
  });

  const createDeviceLink = createRoute({
    method: 'post',
    path: '/pairing/device-link/code',
    request: {
      body: {
        content: { 'application/json': { schema: CreateDeviceLinkCodeRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'One-time code for linking this new device to an existing user',
        content: { 'application/json': { schema: CreateDeviceLinkCodeResponse } },
      },
      401: {
        description: 'Invalid device credential',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(createDeviceLink, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await auth.createDeviceLinkCode(body);
      return c.json(result, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });

  const confirmDeviceLink = createRoute({
    method: 'post',
    path: '/pairing/device-link/confirm',
    request: {
      body: {
        content: { 'application/json': { schema: ConfirmDeviceLinkRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'New device attached to the confirming user',
        content: { 'application/json': { schema: ConfirmDeviceLinkResponse } },
      },
      400: {
        description: 'Cannot link to the same user',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Invalid credentials or pairing code',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(confirmDeviceLink, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await auth.confirmDeviceLink(body);
      return c.json(result, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });
}
