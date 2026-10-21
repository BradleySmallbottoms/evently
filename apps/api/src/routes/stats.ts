import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  ErrorResponse,
  StatsListResponse,
  StatsSourceType,
  UpdateStatsRequest,
} from '@local-events/contracts';
import { parseStatMutation } from '@local-events/domain';
import { z } from 'zod';
import { readUserSessionToken } from '../services/auth/cookies';
import { statsErrorResponse } from '../services/stats/errors';
import { StatsError, type StatsServices } from '../services/stats/types';

const SourceParams = z.object({
  sourceType: StatsSourceType,
  sourceId: z.uuid(),
});

function workerTokenFrom(c: {
  req: { header: (name: string) => string | undefined };
}): string | undefined {
  const auth = c.req.header('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim() || undefined;
  return c.req.header('x-stats-worker-token')?.trim() || undefined;
}

export function registerStatsRoutes(app: OpenAPIHono, stats: StatsServices): void {
  const get = createRoute({
    method: 'get',
    path: '/stats/{sourceType}/{sourceId}',
    request: {
      params: SourceParams,
      query: z.object({
        key: z.union([
          z.string().trim().min(1).max(120),
          z.array(z.string().trim().min(1).max(120)).min(1).max(50),
        ]),
      }),
    },
    responses: {
      200: {
        description: 'Stat rows for the requested keys (missing keys omitted)',
        content: { 'application/json': { schema: StatsListResponse } },
      },
      400: {
        description: 'Missing key query',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'User stats require a session',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      403: {
        description: 'Cannot read another user stats',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      404: {
        description: 'Source not found',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(get, async (c) => {
    try {
      const { sourceType, sourceId } = c.req.valid('param');
      const q = c.req.valid('query');
      const keys = (Array.isArray(q.key) ? q.key : [q.key]).map((k) => k.trim()).filter(Boolean);
      const items = await stats.getStats({
        sourceType,
        sourceId,
        keys,
        sessionToken: readUserSessionToken(c),
      });
      return c.json({ items }, 200);
    } catch (err) {
      return statsErrorResponse(c, err);
    }
  });

  const put = createRoute({
    method: 'put',
    path: '/stats/{sourceType}/{sourceId}',
    request: {
      params: SourceParams,
      body: {
        content: { 'application/json': { schema: UpdateStatsRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Applied mutations (worker token required)',
        content: { 'application/json': { schema: StatsListResponse } },
      },
      400: {
        description: 'Invalid mutation body',
        content: { 'application/json': { schema: ErrorResponse } },
      },
      401: {
        description: 'Missing or invalid worker token',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    },
  });
  app.openapi(put, async (c) => {
    try {
      const { sourceType, sourceId } = c.req.valid('param');
      const body = c.req.valid('json');
      const mutations = [];
      for (const raw of body) {
        const parsed = parseStatMutation(raw);
        if ('error' in parsed) throw new StatsError('bad_request');
        mutations.push(parsed);
      }
      const items = await stats.putStats({
        sourceType,
        sourceId,
        mutations,
        workerToken: workerTokenFrom(c),
      });
      return c.json({ items }, 200);
    } catch (err) {
      return statsErrorResponse(c, err);
    }
  });
}
