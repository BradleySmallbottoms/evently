import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { accessLog, type AccessLogWriter } from './access-log';
import { API_PREFIX, API_VERSION } from './config';
import { registerRoutes } from './routes';
import { registerHealthRoutes } from './routes/health';
import {
  createMemoryAdminAuditServices,
  type AdminAuditMemoryStore,
  type AdminAuditServices,
} from './services/audit';
import {
  createMemoryAdminAuthServices,
  createAdminMemoryAuthStore,
  type AdminMemoryAuthStore,
} from './services/auth/memory';
import type { AdminAuthServices } from './services/auth/types';
import {
  createMemoryAdminDataSourceServices,
  type AdminDataSourceMemoryStore,
  type AdminDataSourceServices,
} from './services/data-sources';
import {
  createMemoryAdminEventServices,
  type AdminEventMemoryStore,
  type AdminEventServices,
} from './services/events';
import {
  createMemoryAdminModerationServices,
  type AdminModerationServices,
} from './services/moderation';
import {
  createMemoryAdminPublisherServices,
  type AdminMemoryStore,
  type AdminPublisherServices,
} from './services/publishers';
import {
  createMemoryAdminPushMessageServices,
  type AdminPushMessageServices,
} from './services/push-messages';
import { Sentry } from './sentry';

export type CreateAdminAppOptions = {
  auth?: AdminAuthServices;
  publishers?: AdminPublisherServices;
  events?: AdminEventServices;
  dataSources?: AdminDataSourceServices;
  audit?: AdminAuditServices;
  moderation?: AdminModerationServices;
  pushMessages?: AdminPushMessageServices;
  authStore?: AdminMemoryAuthStore;
  publisherStore?: AdminMemoryStore;
  eventStore?: AdminEventMemoryStore;
  dataSourceStore?: AdminDataSourceMemoryStore;
  auditStore?: AdminAuditMemoryStore;
  corsOrigin?:
    | string
    | string[]
    | ((origin: string) => string | null | undefined | Promise<string | null | undefined>);
  /** One line per request. Defaults to stdout, and stays quiet under Vitest. */
  accessLog?: AccessLogWriter;
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
  const audit =
    options.audit ?? createMemoryAdminAuditServices(options.auditStore ?? { entries: [] });
  const publishers = options.publishers ?? createMemoryAdminPublisherServices(publisherStore);
  const eventStore = options.eventStore ?? {
    publishers: new Map(),
    events: new Map(),
  };
  const events = options.events ?? createMemoryAdminEventServices(eventStore, { audit });
  const dataSourceStore = options.dataSourceStore ?? {
    sources: new Map(),
    runs: new Map(),
  };
  const dataSources = options.dataSources ?? createMemoryAdminDataSourceServices(dataSourceStore);
  const moderation =
    options.moderation ??
    createMemoryAdminModerationServices(
      { users: new Map(), ratings: new Map(), checkIns: new Map() },
      { audit },
    );
  const pushMessages = options.pushMessages ?? createMemoryAdminPushMessageServices();

  app.onError((err, c) => {
    const requestId = c.res.headers.get('x-request-id') ?? 'unknown';
    console.error('[admin-api] unhandled error', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    Sentry.captureException(err);
    return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
  });

  app.use('*', accessLog(options.accessLog));
  app.use(
    '*',
    cors({
      origin: options.corsOrigin ?? ['http://localhost:13200', 'http://127.0.0.1:13200'],
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposeHeaders: ['X-Request-Id'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  registerHealthRoutes(app);

  const api = new OpenAPIHono();
  api.onError((err, c) => {
    const requestId = c.res.headers.get('x-request-id') ?? 'unknown';
    console.error('[admin-api] route error', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    Sentry.captureException(err);
    return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
  });
  registerRoutes(api, { auth, publishers, events, dataSources, audit, moderation, pushMessages });
  api.doc('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Local Events admin API', version: `${API_VERSION}.0.0` },
  });
  app.route(API_PREFIX, api);

  return app;
}
