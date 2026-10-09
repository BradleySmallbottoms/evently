import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { RegionLookupQuery, RegionLookupResponse } from '@local-events/contracts';
import type { RegionServices } from '../services/regions/types';

export function registerRegionRoutes(app: OpenAPIHono, regions: RegionServices): void {
  const lookup = createRoute({
    method: 'get',
    path: '/regions/lookup',
    request: { query: RegionLookupQuery },
    responses: {
      200: {
        description: 'Region covering the point (municipality preferred), or null',
        content: { 'application/json': { schema: RegionLookupResponse } },
      },
    },
  });
  app.openapi(lookup, async (c) => {
    const query = c.req.valid('query');
    const result = await regions.lookup(query);
    return c.json(result, 200);
  });
}
