import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CheckIn,
  CheckInStatusResponse,
  CreateCodeCheckInRequest,
  CreateGeoCheckInRequest,
  DigitalCodeSessionResponse,
  ErrorResponse,
} from '@local-events/contracts';
import { z } from 'zod';
import {
  readPublisherSessionToken,
  readUserSessionToken,
} from '../services/auth/cookies';
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

  const createCode = createRoute({
    method: 'post',
    path: '/events/{eventId}/check-ins/code',
    request: {
      params: EventIdParam,
      body: {
        content: { 'application/json': { schema: CreateCodeCheckInRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Checked in with a rotating venue / digital code',
        content: { 'application/json': { schema: CheckIn } },
      },
      400: {
        description: 'Invalid code, not started, or outside window',
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
  app.openapi(createCode, async (c) => {
    try {
      const { eventId } = c.req.valid('param');
      const body = c.req.valid('json');
      return c.json(await checkIns.createCode(readUserSessionToken(c), eventId, body), 201);
    } catch (err) {
      return checkInErrorResponse(c, err);
    }
  });

  const startDigitalCode = createRoute({
    method: 'post',
    path: '/manage/events/{eventId}/digital-code/start',
    request: { params: EventIdParam },
    responses: {
      200: {
        description: 'Live code session started (or already running)',
        content: { 'application/json': { schema: DigitalCodeSessionResponse } },
      },
      401: {
        description: 'Missing publisher session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Not a member of the event publisher',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Event not found or not published',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(startDigitalCode, async (c) => {
    try {
      const { eventId } = c.req.valid('param');
      return c.json(
        await checkIns.startDigitalCode(readPublisherSessionToken(c), eventId),
        200,
      );
    } catch (err) {
      return checkInErrorResponse(c, err);
    }
  });

  const getDigitalCode = createRoute({
    method: 'get',
    path: '/manage/events/{eventId}/digital-code',
    request: { params: EventIdParam },
    responses: {
      200: {
        description: 'Current rotating code for the publisher display / venue QR',
        content: { 'application/json': { schema: DigitalCodeSessionResponse } },
      },
      401: {
        description: 'Missing publisher session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Not a member of the event publisher',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Event not found or not published',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(getDigitalCode, async (c) => {
    try {
      const { eventId } = c.req.valid('param');
      return c.json(
        await checkIns.getDigitalCodeSession(readPublisherSessionToken(c), eventId),
        200,
      );
    } catch (err) {
      return checkInErrorResponse(c, err);
    }
  });
}
