import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { TagListQuery, TagListResponse } from '@local-events/contracts';
import type { EventServices } from '../services/events/types';

export function registerTagRoutes(app: OpenAPIHono, events: EventServices): void {
  const listTags = createRoute({
    method: 'get',
    path: '/tags',
    request: { query: TagListQuery },
    responses: {
      200: {
        description:
          'Event tags. Pass upcoming=true to keep tags that have a published event still to come.',
        content: { 'application/json': { schema: TagListResponse } },
      },
    },
  });
  app.openapi(listTags, async (c) => {
    const items = await events.listTags(c.req.valid('query'));
    return c.json({ items }, 200);
  });
}
