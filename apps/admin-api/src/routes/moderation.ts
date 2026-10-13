import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  AdminBanUserRequest,
  AdminEventReportListResponse,
  AdminRatingModerationListResponse,
  AdminSuspiciousCheckInListResponse,
  AdminUserListResponse,
  AdminUserSummary,
  ErrorResponse,
} from '@local-events/contracts';
import { z } from 'zod';
import { readAdminSessionToken } from '../services/auth/cookies';
import { adminAuthErrorResponse } from '../services/auth/errors';
import type { AdminAuthServices } from '../services/auth/types';
import type { AdminModerationServices } from '../services/moderation';

export function registerModerationRoutes(
  app: OpenAPIHono,
  moderation: AdminModerationServices,
  auth: AdminAuthServices,
): void {
  const users = createRoute({
    method: 'get',
    path: '/users',
    responses: {
      200: {
        description: 'App users',
        content: { 'application/json': { schema: AdminUserListResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(users, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      return c.json({ items: await moderation.listUsers() }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const ban = createRoute({
    method: 'post',
    path: '/users/{id}/ban',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: AdminBanUserRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'User banned',
        content: { 'application/json': { schema: AdminUserSummary } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(ban, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await moderation.banUser(
        c.req.valid('param').id,
        c.req.valid('json'),
        session.adminId,
      );
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const unban = createRoute({
    method: 'post',
    path: '/users/{id}/unban',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'User unbanned',
        content: { 'application/json': { schema: AdminUserSummary } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(unban, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await moderation.unbanUser(c.req.valid('param').id, session.adminId);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const ratings = createRoute({
    method: 'get',
    path: '/moderation/ratings',
    responses: {
      200: {
        description: 'Ratings with comments for moderation',
        content: { 'application/json': { schema: AdminRatingModerationListResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(ratings, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      return c.json({ items: await moderation.listRatings() }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const hideRating = createRoute({
    method: 'post',
    path: '/moderation/ratings/{id}/hide',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Rating hidden',
        content: { 'application/json': { schema: z.object({ id: z.uuid() }) } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(hideRating, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await moderation.hideRating(c.req.valid('param').id, session.adminId);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const checkIns = createRoute({
    method: 'get',
    path: '/moderation/check-ins',
    responses: {
      200: {
        description: 'Suspicious check-ins',
        content: { 'application/json': { schema: AdminSuspiciousCheckInListResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(checkIns, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      return c.json({ items: await moderation.listSuspiciousCheckIns() }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const eventReports = createRoute({
    method: 'get',
    path: '/moderation/event-reports',
    responses: {
      200: {
        description: 'User reports of published events',
        content: { 'application/json': { schema: AdminEventReportListResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(eventReports, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      return c.json({ items: await moderation.listEventReports() }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });
}
