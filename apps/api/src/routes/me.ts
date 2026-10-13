import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CreateUserAreaRequest,
  ErrorResponse,
  NotificationListResponse,
  QuietHoursPrefs,
  RegisterPushTokenRequest,
  RegisterPushTokenResponse,
  ReplaceUserInterestsRequest,
  ReplaceUserInterestsResponse,
  UpdateQuietHoursRequest,
  UpdateTravelDistanceRequest,
  UpdateUserAreaRequest,
  UpdateUserProfileRequest,
  UserArea,
  UserAreaListResponse,
  UserPreferencesResponse,
  UserProfile,
} from '@local-events/contracts';
import { z } from 'zod';
import { readUserSessionToken } from '../services/auth/cookies';
import { authErrorResponse } from '../services/auth/errors';
import type { AuthServices } from '../services/auth/types';
import { notificationErrorResponse } from '../services/notifications/errors';
import type { NotificationServices } from '../services/notifications/types';
import { preferenceErrorResponse } from '../services/preferences/errors';
import type { PreferenceServices } from '../services/preferences/types';

const AreaIdParam = z.object({ id: z.uuid() });

export function registerMeRoutes(
  app: OpenAPIHono,
  preferences: PreferenceServices,
  auth: AuthServices,
  notifications: NotificationServices,
): void {
  const getPreferences = createRoute({
    method: 'get',
    path: '/me/preferences',
    responses: {
      200: {
        description: 'Current user interests and saved areas',
        content: { 'application/json': { schema: UserPreferencesResponse } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(getPreferences, async (c) => {
    try {
      const result = await preferences.getPreferences(readUserSessionToken(c));
      return c.json(result, 200);
    } catch (err) {
      return preferenceErrorResponse(c, err);
    }
  });

  const replaceInterests = createRoute({
    method: 'put',
    path: '/me/interests',
    request: {
      body: {
        content: { 'application/json': { schema: ReplaceUserInterestsRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Replaced interest tags',
        content: { 'application/json': { schema: ReplaceUserInterestsResponse } },
      },
      400: {
        description: 'Unknown category',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(replaceInterests, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await preferences.replaceInterests(readUserSessionToken(c), body);
      return c.json(result, 200);
    } catch (err) {
      return preferenceErrorResponse(c, err);
    }
  });

  const listAreas = createRoute({
    method: 'get',
    path: '/me/areas',
    responses: {
      200: {
        description: 'Saved areas',
        content: { 'application/json': { schema: UserAreaListResponse } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(listAreas, async (c) => {
    try {
      const result = await preferences.listAreas(readUserSessionToken(c));
      return c.json(result, 200);
    } catch (err) {
      return preferenceErrorResponse(c, err);
    }
  });

  const createArea = createRoute({
    method: 'post',
    path: '/me/areas',
    request: {
      body: {
        content: { 'application/json': { schema: CreateUserAreaRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Area created',
        content: { 'application/json': { schema: UserArea } },
      },
      400: {
        description: 'Invalid geometry',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Area limit reached',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(createArea, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await preferences.createArea(readUserSessionToken(c), body);
      return c.json(result, 201);
    } catch (err) {
      return preferenceErrorResponse(c, err);
    }
  });

  const updateArea = createRoute({
    method: 'patch',
    path: '/me/areas/{id}',
    request: {
      params: AreaIdParam,
      body: {
        content: { 'application/json': { schema: UpdateUserAreaRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Area updated',
        content: { 'application/json': { schema: UserArea } },
      },
      400: {
        description: 'Invalid geometry',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Area not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(updateArea, async (c) => {
    try {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const result = await preferences.updateArea(readUserSessionToken(c), id, body);
      return c.json(result, 200);
    } catch (err) {
      return preferenceErrorResponse(c, err);
    }
  });

  const deleteArea = createRoute({
    method: 'delete',
    path: '/me/areas/{id}',
    request: { params: AreaIdParam },
    responses: {
      204: { description: 'Area deleted' },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Area not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(deleteArea, async (c) => {
    try {
      const { id } = c.req.valid('param');
      await preferences.deleteArea(readUserSessionToken(c), id);
      return c.body(null, 204);
    } catch (err) {
      return preferenceErrorResponse(c, err);
    }
  });

  const registerPushToken = createRoute({
    method: 'put',
    path: '/me/push-token',
    request: {
      body: {
        content: { 'application/json': { schema: RegisterPushTokenRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Push token stored on the device',
        content: { 'application/json': { schema: RegisterPushTokenResponse } },
      },
      401: {
        description: 'Missing session or device credential mismatch',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(registerPushToken, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await auth.registerPushToken(readUserSessionToken(c), body);
      return c.json(result, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });

  const listNotifications = createRoute({
    method: 'get',
    path: '/me/notifications',
    responses: {
      200: {
        description: 'Notification inbox for the signed-in user',
        content: { 'application/json': { schema: NotificationListResponse } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(listNotifications, async (c) => {
    try {
      const result = await notifications.listNotifications(readUserSessionToken(c));
      return c.json(result, 200);
    } catch (err) {
      return notificationErrorResponse(c, err);
    }
  });

  const updateQuietHours = createRoute({
    method: 'put',
    path: '/me/quiet-hours',
    request: {
      body: {
        content: { 'application/json': { schema: UpdateQuietHoursRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Updated quiet hours',
        content: { 'application/json': { schema: QuietHoursPrefs } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(updateQuietHours, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await preferences.updateQuietHours(readUserSessionToken(c), body);
      return c.json(result, 200);
    } catch (err) {
      return preferenceErrorResponse(c, err);
    }
  });

  const updateTravelDistance = createRoute({
    method: 'put',
    path: '/me/travel-distance',
    request: {
      body: {
        content: { 'application/json': { schema: UpdateTravelDistanceRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Updated travel distance',
        content: { 'application/json': { schema: UpdateTravelDistanceRequest } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(updateTravelDistance, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await preferences.updateTravelDistance(readUserSessionToken(c), body);
      return c.json(result, 200);
    } catch (err) {
      return preferenceErrorResponse(c, err);
    }
  });

  const getProfile = createRoute({
    method: 'get',
    path: '/me/profile',
    responses: {
      200: {
        description: 'Display name / anonymity and optional recovery email',
        content: { 'application/json': { schema: UserProfile } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(getProfile, async (c) => {
    try {
      return c.json(await preferences.getProfile(readUserSessionToken(c)), 200);
    } catch (err) {
      return preferenceErrorResponse(c, err);
    }
  });

  const updateProfile = createRoute({
    method: 'put',
    path: '/me/profile',
    request: {
      body: {
        content: { 'application/json': { schema: UpdateUserProfileRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Updated profile (marks first-check-in prompt as answered)',
        content: { 'application/json': { schema: UserProfile } },
      },
      400: {
        description: 'Invalid display name or missing name for named choice',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Missing or invalid user session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(updateProfile, async (c) => {
    try {
      const body = c.req.valid('json');
      return c.json(await preferences.updateProfile(readUserSessionToken(c), body), 200);
    } catch (err) {
      return preferenceErrorResponse(c, err);
    }
  });
}
