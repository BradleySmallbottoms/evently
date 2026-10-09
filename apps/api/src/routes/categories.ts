import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { CategoryListResponse } from '@local-events/contracts';
import type { EventServices } from '../services/events/types';

export function registerCategoryRoutes(app: OpenAPIHono, events: EventServices): void {
  const listCategories = createRoute({
    method: 'get',
    path: '/categories',
    responses: {
      200: {
        description: 'Event categories',
        content: { 'application/json': { schema: CategoryListResponse } },
      },
    },
  });
  app.openapi(listCategories, async (c) => {
    const items = await events.listCategories();
    return c.json({ items }, 200);
  });
}
