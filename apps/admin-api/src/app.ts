import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { API_PREFIX, API_VERSION } from './config';
import { registerRoutes } from './routes';
import { registerHealthRoutes } from './routes/health';
import {
  createMemoryAdminAuthServices,
  createAdminMemoryAuthStore,
  type AdminMemoryAuthStore,
} from './services/auth/memory';
import type { AdminAuthServices } from './services/auth/types';
import {
  createMemoryAdminPublisherServices,
  type AdminMemoryStore,
  type AdminPublisherServices,
} from './services/publishers';
import { Sentry } from './sentry';

export type CreateAdminAppOptions = {
  auth?: AdminAuthServices;
  publishers?: AdminPublisherServices;
  authStore?: AdminMemoryAuthStore;
  publisherStore?: AdminMemoryStore;
  corsOrigin?:
    | string
    | string[]
    | ((origin: string) => string | null | undefined | Promise<string | null | undefined>);
};

/**
 * Admin API used only by apps/admin. Routes live in `src/routes/`; services in `src/services/`.
 * Versioned routes mount at `API_PREFIX` from package.json `apiVersion`.
 */
export function createApp(options: CreateAdminAppOptions = {}) {
  const app = new OpenAPIHono();
  const authStore = options.authStore ?? createAdminMemoryAuthStore();
  const publisherStore = options.publisherStore ?? {
    publishers: new Map(),
    events: new Map(),
  };
  const auth = options.auth ?? createMemoryAdminAuthServices(authStore);
  const publishers =
    options.publishers ?? createMemoryAdminPublisherServices(publisherStore);

  app.onError((err, c) => {
    Sentry.captureException(err);
    return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
  });

  app.use(
    '*',
    cors({
      origin: options.corsOrigin ?? [
        'http://localhost:3200',
        'http://127.0.0.1:3200',
      ],
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  registerHealthRoutes(app);

  const api = new OpenAPIHono();
  api.onError((err, c) => {
    Sentry.captureException(err);
    return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
  });
  registerRoutes(api, { auth, publishers });
  api.doc('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Local Events admin API', version: `${API_VERSION}.0.0` },
  });
  app.route(API_PREFIX, api);

  return app;
}
