import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  AcceptPublisherInviteRequest,
  AcceptPublisherInviteResponse,
  CreatePublisherInviteRequest,
  CreatePublisherInviteResponse,
  ErrorResponse,
  LoginPublisherRequest,
  LoginPublisherResponse,
  PublisherInviteListResponse,
  PublisherMeResponse,
  PublisherMemberListResponse,
  PublisherProfile,
  RegisterPublisherRequest,
  RegisterPublisherResponse,
  UpdatePublisherProfileRequest,
  VerifyPublisherEmailRequest,
  VerifyPublisherEmailResponse,
} from '@local-events/contracts';
import { z } from 'zod';
import {
  clearPublisherSessionCookie,
  readPublisherSessionToken,
  setPublisherSessionCookie,
} from '../services/auth/cookies';
import { authErrorResponse } from '../services/auth/errors';
import type { AuthServices } from '../services/auth/types';

const PublisherIdParam = z.object({ publisherId: z.uuid() });

export function registerPublisherRoutes(app: OpenAPIHono, auth: AuthServices): void {
  const registerPublisher = createRoute({
    method: 'post',
    path: '/publishers/register',
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
    path: '/publishers/verify-email',
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
    path: '/publishers/login',
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
    path: '/publishers/logout',
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
    path: '/publishers/me',
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

  const getPublisherProfile = createRoute({
    method: 'get',
    path: '/publishers/{publisherId}',
    request: { params: PublisherIdParam },
    responses: {
      200: {
        description: 'Publisher profile for a member',
        content: { 'application/json': { schema: PublisherProfile } },
      },
      401: {
        description: 'Not authenticated or not a member',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(getPublisherProfile, async (c) => {
    try {
      const { publisherId } = c.req.valid('param');
      const result = await auth.getPublisherProfile(
        readPublisherSessionToken(c),
        publisherId,
      );
      return c.json(result, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });

  const updatePublisherProfile = createRoute({
    method: 'patch',
    path: '/publishers/{publisherId}',
    request: {
      params: PublisherIdParam,
      body: {
        content: { 'application/json': { schema: UpdatePublisherProfileRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Updated publisher profile (owner only)',
        content: { 'application/json': { schema: PublisherProfile } },
      },
      401: {
        description: 'Not authenticated or not a member',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Not an owner',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      409: {
        description: 'Slug already taken',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(updatePublisherProfile, async (c) => {
    try {
      const { publisherId } = c.req.valid('param');
      const body = c.req.valid('json');
      const result = await auth.updatePublisherProfile(
        readPublisherSessionToken(c),
        publisherId,
        body,
      );
      return c.json(result, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });

  const listPublisherMembers = createRoute({
    method: 'get',
    path: '/publishers/{publisherId}/members',
    request: { params: PublisherIdParam },
    responses: {
      200: {
        description: 'Members of the publisher',
        content: { 'application/json': { schema: PublisherMemberListResponse } },
      },
      401: {
        description: 'Not authenticated or not a member',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(listPublisherMembers, async (c) => {
    try {
      const { publisherId } = c.req.valid('param');
      const result = await auth.listPublisherMembers(
        readPublisherSessionToken(c),
        publisherId,
      );
      return c.json(result, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });

  const listPublisherInvites = createRoute({
    method: 'get',
    path: '/publishers/{publisherId}/invites',
    request: { params: PublisherIdParam },
    responses: {
      200: {
        description: 'Pending invites (owner only)',
        content: { 'application/json': { schema: PublisherInviteListResponse } },
      },
      401: {
        description: 'Not authenticated or not a member',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Not an owner',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(listPublisherInvites, async (c) => {
    try {
      const { publisherId } = c.req.valid('param');
      const result = await auth.listPublisherInvites(
        readPublisherSessionToken(c),
        publisherId,
      );
      return c.json(result, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });

  const createPublisherInvite = createRoute({
    method: 'post',
    path: '/publishers/{publisherId}/invites',
    request: {
      params: PublisherIdParam,
      body: {
        content: { 'application/json': { schema: CreatePublisherInviteRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Invite created (owner only)',
        content: { 'application/json': { schema: CreatePublisherInviteResponse } },
      },
      401: {
        description: 'Not authenticated or not a member',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Not an owner or member limit reached',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      409: {
        description: 'Already a member or invite pending',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(createPublisherInvite, async (c) => {
    try {
      const { publisherId } = c.req.valid('param');
      const body = c.req.valid('json');
      const result = await auth.createPublisherInvite(
        readPublisherSessionToken(c),
        publisherId,
        body,
      );
      return c.json(result, 201);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });

  const acceptPublisherInvite = createRoute({
    method: 'post',
    path: '/publishers/invites/accept',
    request: {
      body: {
        content: { 'application/json': { schema: AcceptPublisherInviteRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Invite accepted; membership created',
        content: { 'application/json': { schema: AcceptPublisherInviteResponse } },
      },
      400: {
        description: 'Invalid or already used token',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Not authenticated',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Signed-in email does not match invite',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      409: {
        description: 'Already a member',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(acceptPublisherInvite, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await auth.acceptPublisherInvite(readPublisherSessionToken(c), body);
      return c.json(result, 200);
    } catch (err) {
      return authErrorResponse(c, err);
    }
  });
}
