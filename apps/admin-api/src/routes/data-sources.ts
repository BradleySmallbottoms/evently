import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  AdminDataSource,
  AdminDataSourceListResponse,
  AdminDataSourcePatchRequest,
  AdminDataSourceRunResponse,
  AdminIngestionRunListResponse,
  ErrorResponse,
} from '@local-events/contracts';
import { z } from 'zod';
import { readAdminSessionToken } from '../services/auth/cookies';
import { adminAuthErrorResponse } from '../services/auth/errors';
import type { AdminAuthServices } from '../services/auth/types';
import type { AdminDataSourceServices } from '../services/data-sources';

export function registerDataSourceRoutes(
  app: OpenAPIHono,
  dataSources: AdminDataSourceServices,
  auth: AdminAuthServices,
): void {
  const list = createRoute({
    method: 'get',
    path: '/data-sources',
    responses: {
      200: {
        description: 'Configured data sources',
        content: { 'application/json': { schema: AdminDataSourceListResponse } },
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
      return c.json({ items: await dataSources.list() }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const patch = createRoute({
    method: 'patch',
    path: '/data-sources/{id}',
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: { 'application/json': { schema: AdminDataSourcePatchRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Updated data source',
        content: { 'application/json': { schema: AdminDataSource } },
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
      await auth.requireSession(readAdminSessionToken(c));
      const result = await dataSources.patch(c.req.valid('param').id, c.req.valid('json'));
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const runs = createRoute({
    method: 'get',
    path: '/data-sources/{id}/runs',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: 'Recent ingestion runs',
        content: { 'application/json': { schema: AdminIngestionRunListResponse } },
      },
      401: {
        description: 'Admin session required',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(runs, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      return c.json({ items: await dataSources.listRuns(c.req.valid('param').id) }, 200);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });

  const run = createRoute({
    method: 'post',
    path: '/data-sources/{id}/run',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      202: {
        description: 'Ingest run accepted or instructions returned',
        content: { 'application/json': { schema: AdminDataSourceRunResponse } },
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
  app.openapi(run, async (c) => {
    try {
      await auth.requireSession(readAdminSessionToken(c));
      const result = await dataSources.triggerRun(c.req.valid('param').id);
      if (!result) {
        return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      return c.json(result, 202);
    } catch (err) {
      return adminAuthErrorResponse(c, err);
    }
  });
}
