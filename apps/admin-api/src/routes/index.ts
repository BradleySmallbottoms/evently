import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AdminAuditServices } from '../services/audit';
import type { AdminAuthServices } from '../services/auth/types';
import type { AdminDataSourceServices } from '../services/data-sources';
import type { AdminEventServices } from '../services/events';
import type { AdminModerationServices } from '../services/moderation';
import type { AdminPublisherServices } from '../services/publishers';
import { registerAuditRoutes } from './audit';
import { registerAdminAuthRoutes } from './auth';
import { registerDataSourceRoutes } from './data-sources';
import { registerAdminEventRoutes } from './events';
import { registerModerationRoutes } from './moderation';
import { registerPublisherRoutes } from './publishers';

/** Versioned routes only — health is registered on the root app. */
export function registerRoutes(
  app: OpenAPIHono,
  services: {
    auth: AdminAuthServices;
    publishers: AdminPublisherServices;
    events: AdminEventServices;
    dataSources: AdminDataSourceServices;
    audit: AdminAuditServices;
    moderation: AdminModerationServices;
  },
): void {
  registerAdminAuthRoutes(app, services.auth);
  registerPublisherRoutes(app, services.publishers, services.auth);
  registerAdminEventRoutes(app, services.events, services.auth);
  registerDataSourceRoutes(app, services.dataSources, services.auth);
  registerAuditRoutes(app, services.audit, services.auth);
  registerModerationRoutes(app, services.moderation, services.auth);
}
