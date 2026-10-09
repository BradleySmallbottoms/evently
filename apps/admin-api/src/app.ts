import { OpenAPIHono } from '@hono/zod-openapi';
import { API_PREFIX, API_VERSION } from './config';
import { registerRoutes } from './routes';
import { registerHealthRoutes } from './routes/health';
import {
  createMemoryAdminPublisherServices,
  type AdminPublisherServices,
} from './services/publishers';
import { Sentry } from './sentry';

export type CreateAdminAppOptions = {
  publishers?: AdminPublisherServices;
};

/**
 * Admin API used only by apps/admin. Routes live in `src/routes/`; services in `src/services/`.
 * Versioned routes mount at `API_PREFIX` from package.json `apiVersion`.
 */
export function createApp(options: CreateAdminAppOptions = {}) {
  const app = new OpenAPIHono();
  const publishers =
    options.publishers ??
    createMemoryAdminPublisherServices({
      publishers: new Map(),
      events: new Map(),
    });

  app.onError((err, c) => {
    Sentry.captureException(err);
    return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
  });

  registerHealthRoutes(app);

  const api = new OpenAPIHono();
  api.onError((err, c) => {
    Sentry.captureException(err);
    return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
  });
  registerRoutes(api, publishers);
  api.doc('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Local Events admin API', version: `${API_VERSION}.0.0` },
  });
  app.route(API_PREFIX, api);

  return app;
}
