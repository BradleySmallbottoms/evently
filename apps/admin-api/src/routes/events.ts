import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import {
  AdminCollapseOccasionsRequest,
  AdminEventDecisionResponse,
  AdminEventDeleteResponse,
  AdminEventDetail,
  AdminEventListQuery,
  AdminEventListResponse,
  AdminEventPatchRequest,
  AdminEventReviewListResponse,
  AdminEventWorkerListResponse,
  AdminMergeDuplicatesRequest,
  AdminOccasionGroupResponse,
  AdminPossibleDuplicateListResponse,
  AdminPosterResponse,
  TagListResponse,
  ErrorResponse,
} from '@local-events/contracts';
import { POSTER_MAX_BYTES } from '@local-events/domain';
import { z } from 'zod';
import { readAdminSessionToken } from '../services/auth/cookies';
import { adminAuthErrorResponse } from '../services/auth/errors';
import type { AdminAuthServices } from '../services/auth/types';
import { AdminEventError, type AdminEventServices } from '../services/events';

function eventWriteError(c: Parameters<typeof adminAuthErrorResponse>[0], err: unknown) {
  if (err instanceof AdminEventError) {
    const message =
      err.code === 'online_url_required'
        ? 'Digital events need an online URL'
        : err.code === 'unsupported_type'
          ? 'Poster must be a JPEG, PNG, or WebP'
          : err.code === 'too_large'
            ? 'Poster is too large'
            : err.code === 'poster_unavailable'
              ? 'Poster storage is not configured'
              : 'Event is not valid';
    const status = err.code === 'poster_unavailable' ? 503 : 400;
    return c.json({ error: { code: err.code, message } }, status);
  }
  return adminAuthErrorResponse(c, err);
}

export function registerAdminEventRoutes(
  app: OpenAPIHono,
  events: AdminEventServices,
  auth: AdminAuthServices,
): void {
  const list = createRoute({
    method: 'get',
    path: '/events',
    request: {
      query: AdminEventListQuery,
    },
    responses: {
      200: {
        description: 'Admin event list (review queue when status=in_review)',
        content: {
          'application/json': {
            schema: z.union([AdminEventReviewListResponse, AdminEventListResponse]),
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
      const query = c.req.valid('query');
      // The review queue pages with sort=created. An unpaged in_review call keeps the review shape.
      const paged =
        query.q !== undefined ||
        query.untagged === 'true' ||
        query.worker !== undefined ||
        c.req.query('limit') !== undefined ||
        c.req.query('offset') !== undefined;
      if (query.status === 'in_review' && !paged) {
        return c.json({ items: await events.listInReview() }, 200);
      }
      return c.json(await events.list(query), 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const workers = createRoute({
    method: 'get',
    path: '/events/workers',
    responses: {
      200: {
        description: 'Distinct worker ids on events that are still listed',
        content: {
          'application/json': { schema: AdminEventWorkerListResponse },
        },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(workers, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      return c.json({ items: await events.listWorkerIds() }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const tags = createRoute({
    method: 'get',
    path: '/tags',
    responses: {
      200: {
        description: 'Event tags',
        content: { 'application/json': { schema: TagListResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(tags, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      return c.json({ items: await events.listTags() }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const getOne = createRoute({
    method: 'get',
    path: '/events/{id}',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Event detail',
        content: { 'application/json': { schema: AdminEventDetail } },
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
      const item = await events.get(c.req.valid('param').id);
      if (!item) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(item, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const approve = createRoute({
    method: 'post',
    path: '/events/{id}/approve',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Imported event published',
        content: { 'application/json': { schema: AdminEventDecisionResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found or not in review',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(approve, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await events.approve(c.req.valid('param').id, session.adminId);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const reject = createRoute({
    method: 'post',
    path: '/events/{id}/reject',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Imported event cancelled',
        content: { 'application/json': { schema: AdminEventDecisionResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found or not in review',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(reject, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await events.reject(c.req.valid('param').id, session.adminId);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const rescan = createRoute({
    method: 'post',
    path: '/events/{id}/rescan',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Imported event queued for another scan',
        content: { 'application/json': { schema: AdminEventDecisionResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found, or not an imported event in review or published',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(rescan, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await events.rescan(c.req.valid('param').id, session.adminId);
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
    path: '/events/{id}',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Imported event marked deleted and kept',
        content: { 'application/json': { schema: AdminEventDecisionResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found or not in review',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(remove, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await events.softDelete(c.req.valid('param').id, session.adminId);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const wipe = createRoute({
    method: 'post',
    path: '/events/{id}/wipe',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Event removed',
        content: { 'application/json': { schema: AdminEventDeleteResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found, or someone has checked in, saved, rated, or been notified',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(wipe, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await events.wipe(c.req.valid('param').id, session.adminId);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const occasionGroup = createRoute({
    method: 'get',
    path: '/events/{id}/occasion-group',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Open events that share this event’s scan occasion group',
        content: { 'application/json': { schema: AdminOccasionGroupResponse } },
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
  app.openapi(occasionGroup, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const items = await events.listOccasionGroup(c.req.valid('param').id);
      if (!items) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json({ items }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const collapse = createRoute({
    method: 'post',
    path: '/events/{id}/collapse',
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: { 'application/json': { schema: AdminCollapseOccasionsRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Checked events folded into this event and removed',
        content: { 'application/json': { schema: AdminEventDetail } },
      },
      400: {
        description: 'The selection is not in this scan occasion group',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found, or this event has no scan occasion group',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(collapse, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await events.collapseOccasions(
        c.req.valid('param').id,
        c.req.valid('json').eventIds,
        session.adminId,
      );
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return eventWriteError(c, err);
    }
  });

  const possibleDuplicates = createRoute({
    method: 'get',
    path: '/events/{id}/possible-duplicates',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Open events flagged as duplicates of this event, with their occasions',
        content: { 'application/json': { schema: AdminPossibleDuplicateListResponse } },
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
  app.openapi(possibleDuplicates, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const items = await events.listPossibleDuplicates(c.req.valid('param').id);
      if (!items) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json({ items }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const mergeDuplicates = createRoute({
    method: 'post',
    path: '/events/{id}/merge-duplicates',
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: { 'application/json': { schema: AdminMergeDuplicatesRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Checked duplicates hidden, or moved onto this event when occasions is move',
        content: { 'application/json': { schema: AdminEventDetail } },
      },
      400: {
        description: 'The selection is not a possible duplicate of this event',
        content: { 'application/json': { schema: ErrorResponse } },
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
  app.openapi(mergeDuplicates, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const body = c.req.valid('json');
      const result = await events.mergeDuplicates(
        c.req.valid('param').id,
        body.eventIds,
        session.adminId,
        body.occasions,
      );
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return eventWriteError(c, err);
    }
  });

  app.use(
    '/events/:id/poster',
    bodyLimit({
      maxSize: POSTER_MAX_BYTES,
      onError: (c) => c.json({ error: { code: 'too_large', message: 'Poster is too large' } }, 400),
    }),
  );

  const poster = createRoute({
    method: 'post',
    path: '/events/{id}/poster',
    request: {
      params: z.object({ id: z.uuid() }),
    },
    responses: {
      200: {
        description: 'Sponsored poster stored',
        content: { 'application/json': { schema: AdminPosterResponse } },
      },
      400: {
        description: 'The file is not a JPEG, PNG, or WebP, or it is too large',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      503: {
        description: 'Poster storage is not configured',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(poster, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const declared = Number(c.req.header('content-length') ?? '');
      if (Number.isFinite(declared) && declared > POSTER_MAX_BYTES) {
        throw new AdminEventError('too_large');
      }
      const contentType = c.req.header('content-type') ?? '';
      const body = new Uint8Array(await c.req.arrayBuffer());
      const result = await events.putPoster(
        c.req.valid('param').id,
        body,
        contentType,
        session.adminId,
      );
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return eventWriteError(c, err);
    }
  });

  const deletePoster = createRoute({
    method: 'delete',
    path: '/events/{id}/poster',
    request: {
      params: z.object({ id: z.uuid() }),
    },
    responses: {
      200: {
        description: 'Sponsored poster removed',
        content: { 'application/json': { schema: AdminPosterResponse } },
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
  app.openapi(deletePoster, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await events.deletePoster(c.req.valid('param').id, session.adminId);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return eventWriteError(c, err);
    }
  });

  const patch = createRoute({
    method: 'patch',
    path: '/events/{id}',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: AdminEventPatchRequest } }, required: true },
    },
    responses: {
      200: {
        description: 'Updated event',
        content: { 'application/json': { schema: AdminEventDetail } },
      },
      400: {
        description: 'Invalid event fields',
        content: { 'application/json': { schema: ErrorResponse } },
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
  app.openapi(patch, async (c) => {
    try {
      const session = await auth.requireSession(readAdminSessionToken(c));
      const result = await events.patch(
        c.req.valid('param').id,
        c.req.valid('json'),
        session.adminId,
      );
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return eventWriteError(c, err);
    }
  });
}
