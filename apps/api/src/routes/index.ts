import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AuthServices } from '../services/auth/types';
import type { EventServices } from '../services/events/types';
import { registerCategoryRoutes } from './categories';
import { registerEventRoutes } from './events';
import { registerIdentityRoutes } from './identities';
import { registerPublisherRoutes } from './publishers';
import { registerSessionRoutes } from './sessions';

export type ApiRouteServices = {
  auth: AuthServices;
  events: EventServices;
};

/**
 * Register versioned route groups (paths without `/vN` — the app mounts this at `API_PREFIX`).
 * Health is registered separately on the root app.
 */
export function registerRoutes(app: OpenAPIHono, services: ApiRouteServices): void {
  registerIdentityRoutes(app, services.auth);
  registerSessionRoutes(app, services.auth);
  registerPublisherRoutes(app, services.auth);
  registerCategoryRoutes(app, services.events);
  registerEventRoutes(app, services.events);
}
