import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  AdminLoginChallengeResponse,
  AdminLoginRequest,
  AdminOtpConfirmRequest,
  AdminOtpLoginRequest,
  AdminOtpLoginResponse,
  AdminSessionResponse,
  AdminTotpConfirmRequest,
  ErrorResponse,
} from '@local-events/contracts';
import {
  clearAdminSessionCookie,
  readAdminSessionToken,
  setAdminSessionCookie,
} from '../services/auth/cookies';
import { adminAuthErrorResponse } from '../services/auth/errors';
import type { AdminAuthServices } from '../services/auth/types';

export function registerAdminAuthRoutes(app: OpenAPIHono, auth: AdminAuthServices): void {
  const login = createRoute({
    method: 'post',
    path: '/admin/login',
    request: {
      body: { content: { 'application/json': { schema: AdminLoginRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'Password accepted; continue with TOTP setup or challenge',
        content: { 'application/json': { schema: AdminLoginChallengeResponse } },
      },
      401: {
        description: 'Invalid credentials',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(login, async (c) => {
    try {
      return c.json(await auth.login(c.req.valid('json')), 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const confirm = createRoute({
    method: 'post',
    path: '/admin/login/totp',
    request: {
      body: {
        content: { 'application/json': { schema: AdminTotpConfirmRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Session created',
        content: { 'application/json': { schema: AdminSessionResponse } },
      },
      401: {
        description: 'Invalid or expired challenge / TOTP',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  const requestOtp = createRoute({
    method: 'post',
    path: '/admin/login/otp',
    request: {
      body: { content: { 'application/json': { schema: AdminOtpLoginRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'Code issued when the email is an admin. Unknown emails get the same body.',
        content: { 'application/json': { schema: AdminOtpLoginResponse } },
      },
      429: {
        description: 'Too many code requests for this email',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(requestOtp, async (c) => {
    try {
      return c.json(await auth.requestOtp(c.req.valid('json')), 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const confirmOtp = createRoute({
    method: 'post',
    path: '/admin/login/otp/confirm',
    request: {
      body: {
        content: { 'application/json': { schema: AdminOtpConfirmRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Session created',
        content: { 'application/json': { schema: AdminSessionResponse } },
      },
      401: {
        description: 'Invalid or expired code',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(confirmOtp, async (c) => {
    try {
      const result = await auth.confirmOtp(c.req.valid('json'));
      setAdminSessionCookie(c, result.sessionToken, new Date(result.expiresAt));
      return c.json(
        {
          adminId: result.adminId,
          email: result.email,
          role: result.role,
          expiresAt: result.expiresAt,
        },
        200,
      );
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  app.openapi(confirm, async (c) => {
    try {
      const result = await auth.confirmTotp(c.req.valid('json'));
      setAdminSessionCookie(c, result.sessionToken, new Date(result.expiresAt));
      return c.json(
        {
          adminId: result.adminId,
          email: result.email,
          role: result.role,
          expiresAt: result.expiresAt,
        },
        200,
      );
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const me = createRoute({
    method: 'get',
    path: '/admin/me',
    responses: {
      200: {
        description: 'Current admin session',
        content: { 'application/json': { schema: AdminSessionResponse } },
      },
      401: {
        description: 'Missing session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(me, async (c) => {
    try {
      return c.json(await auth.me(readAdminSessionToken(c)), 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const logout = createRoute({
    method: 'post',
    path: '/admin/logout',
    responses: {
      204: { description: 'Logged out' },
    },
  });
  app.openapi(logout, async (c) => {
    await auth.logout(readAdminSessionToken(c));
    clearAdminSessionCookie(c);
    return c.body(null, 204);
  });
}
