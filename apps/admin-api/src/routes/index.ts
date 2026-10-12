import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AdminAuthServices } from '../services/auth/types';
import type { AdminPublisherServices } from '../services/publishers';
import { registerAdminAuthRoutes } from './auth';
import { registerPublisherRoutes } from './publishers';

/** Versioned routes only — health is registered on the root app. */
export function registerRoutes(
  app: OpenAPIHono,
  services: { auth: AdminAuthServices; publishers: AdminPublisherServices },
): void {
  registerAdminAuthRoutes(app, services.auth);
  registerPublisherRoutes(app, services.publishers, services.auth);
}
