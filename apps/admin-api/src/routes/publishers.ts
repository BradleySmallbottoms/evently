import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  AdminCompletePublisherRequest,
  AdminCompletePublisherResponse,
  AdminCreatePublisherAccountRequest,
  AdminPatchPublisherAccountRequest,
  AdminPublisherAccount,
  AdminPublisherAccountDirectoryResponse,
  AdminPublisherAccountListResponse,
  AdminPublisherAccountPasswordRequest,
  AdminPublisherAccountLookupResponse,
  AdminMapPublisherRequest,
  AdminMapPublisherResponse,
  AdminPublisherDeleteResponse,
  AdminPublisherEventListResponse,
  AdminPublisherListResponse,
  AdminPublisherPatchRequest,
  AdminTemporaryPublisherListResponse,
  ErrorResponse,
  PublisherSummaryAdmin,
  VerifyPublisherResponse,
} from '@local-events/contracts';
import { z } from 'zod';
import { readAdminSessionToken } from '../services/auth/cookies';
import { adminAuthErrorResponse } from '../services/auth/errors';
import type { AdminAuthServices } from '../services/auth/types';
import type { AdminPublisherServices } from '../services/publishers';

export function registerPublisherRoutes(
  app: OpenAPIHono,
  publishers: AdminPublisherServices,
  auth: AdminAuthServices,
): void {
  const list = createRoute({
    method: 'get',
    path: '/publishers',
    request: {
      query: z.object({
        status: z.enum(['pending_scan', 'in_review', 'published']).optional(),
        temporary: z.enum(['true', 'false']).optional(),
        all: z.enum(['true', 'false']).optional(),
      }),
    },
    responses: {
      200: {
        description: 'Publishers (in review, temporary, or all)',
        content: {
          'application/json': {
            schema: z.union([AdminPublisherListResponse, AdminTemporaryPublisherListResponse]),
          },
        },
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
      const { status, temporary, all } = c.req.valid('query');
      if (temporary === 'true') {
        return c.json({ items: await publishers.listTemporary() }, 200);
      }
      if (all === 'true') {
        return c.json({ items: await publishers.listAll() }, 200);
      }
      if (status && status !== 'in_review') return c.json({ items: [] }, 200);
      return c.json({ items: await publishers.listUnverified() }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const verify = createRoute({
    method: 'post',
    path: '/publishers/{id}/verify',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Publisher verified; upcoming awaiting events released',
        content: { 'application/json': { schema: VerifyPublisherResponse } },
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
  app.openapi(verify, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const { id } = c.req.valid('param');
      const result = await publishers.verify(id);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const map = createRoute({
    method: 'post',
    path: '/publishers/{id}/map',
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: { 'application/json': { schema: AdminMapPublisherRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Temporary publisher remapped; events moved',
        content: { 'application/json': { schema: AdminMapPublisherResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found or not temporary',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(map, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const result = await publishers.mapTo({
        sourcePublisherId: id,
        targetPublisherId: body.targetPublisherId,
        adminId: session.adminId,
      });
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const complete = createRoute({
    method: 'post',
    path: '/publishers/{id}/complete',
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: { 'application/json': { schema: AdminCompletePublisherRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Temporary publisher details completed',
        content: { 'application/json': { schema: AdminCompletePublisherResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found, not temporary, or slug taken',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(complete, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const result = await publishers.complete(c.req.valid('param').id, c.req.valid('json'));
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const getOne = createRoute({
    method: 'get',
    path: '/publishers/{id}',
    request: {
      params: z.object({ id: z.uuid() }),
    },
    responses: {
      200: {
        description: 'Publisher',
        content: { 'application/json': { schema: PublisherSummaryAdmin } },
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
  app.openapi(getOne, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const result = await publishers.get(c.req.valid('param').id);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const patch = createRoute({
    method: 'patch',
    path: '/publishers/{id}',
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: { 'application/json': { schema: AdminPublisherPatchRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Publisher updated',
        content: { 'application/json': { schema: PublisherSummaryAdmin } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found or slug taken',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(patch, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const result = await publishers.patch(c.req.valid('param').id, c.req.valid('json'));
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const events = createRoute({
    method: 'get',
    path: '/publishers/{id}/events',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Events for this publisher, newest start first',
        content: { 'application/json': { schema: AdminPublisherEventListResponse } },
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
  app.openapi(events, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const result = await publishers.listEvents(c.req.valid('param').id);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const remove = createRoute({
    method: 'delete',
    path: '/publishers/{id}',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Publisher removed',
        content: { 'application/json': { schema: AdminPublisherDeleteResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      409: {
        description: 'Publisher still has events',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(remove, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const result = await publishers.remove(c.req.valid('param').id);
      if (!result.ok && result.reason === 'not_found') {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      if (!result.ok) {
        return c.json(
          { error: { code: 'publisher_has_events', message: 'Publisher has events' } },
          409,
        );
      }
      return c.json({ id: result.id }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const listAccounts = createRoute({
    method: 'get',
    path: '/publishers/{id}/accounts',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Publisher accounts that can sign in for this publisher',
        content: { 'application/json': { schema: AdminPublisherAccountListResponse } },
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
  app.openapi(listAccounts, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const result = await publishers.listAccounts(c.req.valid('param').id);
      if (!result) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const lookupAccount = createRoute({
    method: 'get',
    path: '/publishers/{id}/accounts/lookup',
    request: {
      params: z.object({ id: z.uuid() }),
      query: z.object({ email: z.email() }),
    },
    responses: {
      200: {
        description: 'Whether this email is a new account, an existing one, or already a member',
        content: { 'application/json': { schema: AdminPublisherAccountLookupResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Publisher not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(lookupAccount, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const result = await publishers.lookupAccount(
        c.req.valid('param').id,
        c.req.valid('query').email,
      );
      if (!result.ok) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      return c.json({ status: result.status }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const createAccount = createRoute({
    method: 'post',
    path: '/publishers/{id}/accounts',
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: { 'application/json': { schema: AdminCreatePublisherAccountRequest } },
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Account created or attached',
        content: { 'application/json': { schema: AdminPublisherAccount } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Publisher not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      400: {
        description: 'A new account needs a password',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      409: {
        description: 'Account is already a member',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(createAccount, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const result = await publishers.createAccount(c.req.valid('param').id, c.req.valid('json'));
      if (!result.ok && result.reason === 'password_required') {
        return c.json(
          { error: { code: 'password_required', message: 'A new account needs a password' } },
          400,
        );
      }
      if (!result.ok && result.reason === 'already_member') {
        return c.json(
          { error: { code: 'already_member', message: 'Account is already a member' } },
          409,
        );
      }
      if (!result.ok) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      return c.json(result.account, 201);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const patchAccount = createRoute({
    method: 'patch',
    path: '/publishers/{id}/accounts/{accountId}',
    request: {
      params: z.object({ id: z.uuid(), accountId: z.uuid() }),
      body: {
        content: { 'application/json': { schema: AdminPatchPublisherAccountRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Account updated',
        content: { 'application/json': { schema: AdminPublisherAccount } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      409: {
        description: 'Email is already used',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(patchAccount, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const { id, accountId } = c.req.valid('param');
      const result = await publishers.patchAccount(id, accountId, c.req.valid('json'));
      if (!result.ok && result.reason === 'email_taken') {
        return c.json(
          { error: { code: 'email_taken', message: 'Email is already registered' } },
          409,
        );
      }
      if (!result.ok) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      return c.json(result.account, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const removeAccount = createRoute({
    method: 'delete',
    path: '/publishers/{id}/accounts/{accountId}',
    request: { params: z.object({ id: z.uuid(), accountId: z.uuid() }) },
    responses: {
      204: { description: 'Account removed from this publisher' },
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
  app.openapi(removeAccount, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const { id, accountId } = c.req.valid('param');
      const result = await publishers.removeAccount(id, accountId);
      if (!result.ok) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      return c.body(null, 204);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const listAccountDirectory = createRoute({
    method: 'get',
    path: '/publisher-accounts',
    responses: {
      200: {
        description: 'Every publisher account',
        content: { 'application/json': { schema: AdminPublisherAccountDirectoryResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(listAccountDirectory, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      return c.json(await publishers.listAccountDirectory(), 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const setAccountPassword = createRoute({
    method: 'patch',
    path: '/publisher-accounts/{accountId}',
    request: {
      params: z.object({ accountId: z.uuid() }),
      body: {
        content: { 'application/json': { schema: AdminPublisherAccountPasswordRequest } },
        required: true,
      },
    },
    responses: {
      204: { description: 'Password changed and sessions signed out' },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Account not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(setAccountPassword, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const result = await publishers.setAccountPassword(
        c.req.valid('param').accountId,
        c.req.valid('json'),
      );
      if (!result.ok) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      return c.body(null, 204);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });
}
