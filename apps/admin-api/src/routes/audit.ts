import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { AdminAuditLogListResponse, ErrorResponse } from '@local-events/contracts';
import { readAdminSessionToken } from '../services/auth/cookies';
import { adminAuthErrorResponse } from '../services/auth/errors';
import type { AdminAuthServices } from '../services/auth/types';
import type { AdminAuditServices } from '../services/audit';

export function registerAuditRoutes(
  app: OpenAPIHono,
  audit: AdminAuditServices,
  auth: AdminAuthServices,
): void {
  const list = createRoute({
    method: 'get',
    path: '/audit-log',
    responses: {
      200: {
        description: 'Recent audit log entries',
        content: { 'application/json': { schema: AdminAuditLogListResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(list, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      return c.json({ items: await audit.list() }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });
}
