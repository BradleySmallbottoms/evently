import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { API_PREFIX, API_VERSION } from './config';
import { registerRoutes } from './routes';
import { registerHealthRoutes } from './routes/health';
import { createMemoryAuthServices } from './services/auth/memory';
import type { AuthServices } from './services/auth/types';
import { createMemoryEventServices } from './services/events/memory';
import type { EventServices } from './services/events/types';
import { createMemoryStore } from './services/memory-store';
import { Sentry } from './sentry';

export type CreateAppOptions = {
  auth?: AuthServices;
  events?: EventServices;
  /**
   * Origins allowed for credentialed CORS (web publisher login).
   * Pass a string list, or a function that returns the reflected Origin (never bare `*`).
   */
  corsOrigin?:
    | string
    | string[]
    | ((origin: string) => string | null | undefined | Promise<string | null | undefined>);
};

/**
 * Public API used by the mobile app and web app. Routes live in `src/routes/` (one file per
 * resource group); persistence/adapters live in `src/services/`.
 * Versioned routes are mounted at `API_PREFIX` from package.json `apiVersion` (e.g. `/v1`).
 */
export function createApp(options: CreateAppOptions = {}) {
  const store = createMemoryStore();
  const defaultEnv = { includeVerificationToken: true, now: () => new Date() };
  const auth = options.auth ?? createMemoryAuthServices(defaultEnv, store);
  const events =
    options.events ?? createMemoryEventServices(auth, { now: defaultEnv.now }, store);
  const app = new OpenAPIHono();

  app.onError((err, c) => {
    Sentry.captureException(err);
    return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
  });

  app.use(
    '*',
    cors({
      origin: options.corsOrigin ?? [
        'http://localhost:3100',
        'http://127.0.0.1:3100',
        'http://localhost:8081',
        'http://127.0.0.1:8081',
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
  registerRoutes(api, { auth, events });
  api.doc('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Local Events public API', version: `${API_VERSION}.0.0` },
  });
  app.route(API_PREFIX, api);

  return app;
}
