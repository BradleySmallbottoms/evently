import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { API_PREFIX, API_VERSION } from './config';
import { registerRoutes } from './routes';
import { registerHealthRoutes } from './routes/health';
import { createMemoryAuthServices } from './services/auth/memory';
import type { AuthServices } from './services/auth/types';
import { createMemoryCheckInServices } from './services/check-ins/memory';
import type { CheckInServices } from './services/check-ins/types';
import { createMemoryEventContentServices } from './services/event-content/memory';
import type { EventContentServices } from './services/event-content/types';
import { createMemoryEventServices } from './services/events/memory';
import type { EventServices } from './services/events/types';
import { createMemoryNotificationServices } from './services/notifications/memory';
import type { NotificationServices } from './services/notifications/types';
import { createMemoryPreferenceServices } from './services/preferences/memory';
import type { PreferenceServices } from './services/preferences/types';
import { createMemoryRatingServices } from './services/ratings/memory';
import type { RatingServices } from './services/ratings/types';
import { createMemoryRegionServices } from './services/regions/memory';
import type { RegionServices } from './services/regions/types';
import { createMemoryStatsServices } from './services/stats/memory';
import type { StatsServices } from './services/stats/types';
import { createMemoryLibraryServices } from './services/library/memory';
import type { LibraryServices } from './services/library/types';
import { createMemorySubscriptionServices } from './services/subscriptions/memory';
import type { SubscriptionServices } from './services/subscriptions/types';
import { createMemoryStore } from './services/memory-store';
import { Sentry } from './sentry';

export type CreateAppOptions = {
  auth?: AuthServices;
  events?: EventServices;
  preferences?: PreferenceServices;
  regions?: RegionServices;
  subscriptions?: SubscriptionServices;
  library?: LibraryServices;
  checkIns?: CheckInServices;
  notifications?: NotificationServices;
  eventContent?: EventContentServices;
  ratings?: RatingServices;
  stats?: StatsServices;
  /**
   * Origins allowed for credentialed CORS (web publisher login).
   * Pass a string list, or a function that returns the reflected Origin (never bare `*`).
   */
  corsOrigin?:
    | string
    | string[]
    | ((origin: string) => string | null | undefined | Promise<string | null | undefined>);
  /** Local Garage website origin. Used only to proxy images phones cannot reach. */
  assetsPublicBaseUrl?: string;
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
  const preferences =
    options.preferences ??
    createMemoryPreferenceServices(auth, { now: defaultEnv.now }, store);
  const regions = options.regions ?? createMemoryRegionServices(store);
  const subscriptions =
    options.subscriptions ?? createMemorySubscriptionServices(auth, store);
  const library = options.library ?? createMemoryLibraryServices(auth, store);
  const checkIns = options.checkIns ?? createMemoryCheckInServices(auth, {}, store);
  const notifications =
    options.notifications ?? createMemoryNotificationServices(auth, store);
  const eventContent =
    options.eventContent ?? createMemoryEventContentServices(auth, {}, store);
  const ratings = options.ratings ?? createMemoryRatingServices(auth, {}, store);
  const stats =
    options.stats ??
    createMemoryStatsServices(auth, store, { workerToken: 'test-stats-worker-token' });
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
      allowHeaders: ['Content-Type', 'Authorization', 'X-Stats-Worker-Token'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  registerHealthRoutes(app);

  const api = new OpenAPIHono();
  api.onError((err, c) => {
    Sentry.captureException(err);
    return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
  });
  registerRoutes(
    api,
    {
      auth,
      events,
      preferences,
      regions,
      subscriptions,
      library,
      checkIns,
      notifications,
      eventContent,
      ratings,
      stats,
    },
    { assetsPublicBaseUrl: options.assetsPublicBaseUrl },
  );
  api.doc('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Local Events public API', version: `${API_VERSION}.0.0` },
  });
  app.route(API_PREFIX, api);

  return app;
}
