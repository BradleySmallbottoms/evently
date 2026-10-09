import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CheckIn,
  CheckInStatusResponse,
  CreateGeoCheckInRequest,
  ErrorResponse,
} from '@local-events/contracts';
import { z } from 'zod';
import { readUserSessionToken } from '../services/auth/cookies';
import { checkInErrorResponse } from '../services/check-ins/errors';
import type { CheckInServices } from '../services/check-ins/types';

const EventIdParam = z.object({ eventId: z.uuid() });

export function registerCheckInRoutes(app: OpenAPIHono, checkIns: CheckInServices): void {
  const status = createRoute({
    method: 'get',
    path: '/events/{eventId}/check-in',
    request: { params: EventIdParam },
    responses: {
      200: {
        description: 'Whether the user has checked in and if the window is open',
        content: { 'application/json': { schema: CheckInStatusResponse } },
      },
      401: {
        description: 'Missing session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Event not found or not published',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(status, async (c) => {
    try {
      const { eventId } = c.req.valid('param');
      return c.json(await checkIns.getStatus(readUserSessionToken(c), eventId), 200);
    } catch (err) {
      return checkInErrorResponse(c, err);
    }
  });

  const createGeo = createRoute({
    method: 'post',
    path: '/events/{eventId}/check-ins',
    request: {
      params: EventIdParam,
      body: {
        content: { 'application/json': { schema: CreateGeoCheckInRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Checked in at the venue',
        content: { 'application/json': { schema: CheckIn } },
      },
      400: {
        description: 'Validation failed (window, accuracy, geofence, mode)',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Missing session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Event not found or not published',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      409: {
        description: 'Already checked in',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(createGeo, async (c) => {
    try {
      const { eventId } = c.req.valid('param');
      const body = c.req.valid('json');
      return c.json(await checkIns.createGeo(readUserSessionToken(c), eventId, body), 201);
    } catch (err) {
      return checkInErrorResponse(c, err);
    }
  });
}
