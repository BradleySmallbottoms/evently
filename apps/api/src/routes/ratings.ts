import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CreateRatingRequest,
  ErrorResponse,
  PublisherRatingListResponse,
  Rating,
  RatingStatusResponse,
} from '@local-events/contracts';
import { z } from 'zod';
import {
  readPublisherSessionToken,
  readUserSessionToken,
} from '../services/auth/cookies';
import { ratingErrorResponse } from '../services/ratings/errors';
import type { RatingServices } from '../services/ratings/types';

const EventIdParam = z.object({ eventId: z.uuid() });

export function registerRatingRoutes(app: OpenAPIHono, ratings: RatingServices): void {
  const status = createRoute({
    method: 'get',
    path: '/events/{eventId}/rating',
    request: { params: EventIdParam },
    responses: {
      200: {
        description: 'Whether the user can rate and public aggregate',
        content: { 'application/json': { schema: RatingStatusResponse } },
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
      return c.json(await ratings.getStatus(readUserSessionToken(c), eventId), 200);
    } catch (err) {
      return ratingErrorResponse(c, err);
    }
  });

  const create = createRoute({
    method: 'post',
    path: '/events/{eventId}/ratings',
    request: {
      params: EventIdParam,
      body: {
        content: { 'application/json': { schema: CreateRatingRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Rating created (comment never returned on this surface)',
        content: { 'application/json': { schema: Rating } },
      },
      400: {
        description: 'Not eligible or comment not allowed',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Missing session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Event not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      409: {
        description: 'Already rated',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(create, async (c) => {
    try {
      const { eventId } = c.req.valid('param');
      const body = c.req.valid('json');
      return c.json(await ratings.create(readUserSessionToken(c), eventId, body), 201);
    } catch (err) {
      return ratingErrorResponse(c, err);
    }
  });

  const listManaged = createRoute({
    method: 'get',
    path: '/manage/events/{eventId}/ratings',
    request: { params: EventIdParam },
    responses: {
      200: {
        description: 'Ratings with comments for the publisher',
        content: { 'application/json': { schema: PublisherRatingListResponse } },
      },
      401: {
        description: 'Missing publisher session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Not a member',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Event not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(listManaged, async (c) => {
    try {
      const { eventId } = c.req.valid('param');
      return c.json(
        await ratings.listManaged(readPublisherSessionToken(c), eventId),
        200,
      );
    } catch (err) {
      return ratingErrorResponse(c, err);
    }
  });
}
