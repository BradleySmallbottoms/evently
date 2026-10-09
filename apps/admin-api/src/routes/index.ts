import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AdminPublisherServices } from '../services/publishers';
import { registerPublisherRoutes } from './publishers';

/** Versioned routes only — health is registered on the root app. */
export function registerRoutes(app: OpenAPIHono, publishers: AdminPublisherServices): void {
  registerPublisherRoutes(app, publishers);
}
