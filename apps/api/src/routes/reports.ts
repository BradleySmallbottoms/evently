import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { ErrorResponse, EventReport } from '@local-events/contracts';
import { z } from 'zod';
import { readUserSessionToken } from '../services/auth/cookies';
import { reportErrorResponse } from '../services/reports/errors';
import type { ReportServices } from '../services/reports/types';

const EventIdParam = z.object({ eventId: z.uuid() });

export function registerReportRoutes(app: OpenAPIHono, reports: ReportServices): void {
  const create = createRoute({
    method: 'post',
    path: '/events/{eventId}/reports',
    request: { params: EventIdParam },
    responses: {
      201: {
        description: 'Report stored',
        content: { 'application/json': { schema: EventReport } },
      },
      200: {
        description: 'This user already reported the event',
        content: { 'application/json': { schema: EventReport } },
      },
      401: {
        description: 'Missing session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Banned user',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Event not found or not published',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(create, async (c) => {
    try {
      const { eventId } = c.req.valid('param');
      const result = await reports.create(readUserSessionToken(c), eventId);
      return c.json(result.report, result.created ? 201 : 200);
    } catch (err) {
      return reportErrorResponse(c, err);
    }
  });
}
