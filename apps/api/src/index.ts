import { serve } from '@hono/node-server';
import { createDb, resolveDatabaseUrl } from '@local-events/db';
import { createApp } from './app';
import { createDbAuthServices } from './services/auth/db';
import { createMemoryAuthServices } from './services/auth/memory';
import { createDbCheckInServices } from './services/check-ins/db';
import { createMemoryCheckInServices } from './services/check-ins/memory';
import { createDbEventServices } from './services/events/db';
import { createMemoryEventServices } from './services/events/memory';
import { createMemoryDomainEventPublisher } from './services/domain-events/memory';
import { createSqsDomainEventPublisher } from './services/domain-events/sqs';
import { createDbNotificationServices } from './services/notifications/db';
import { createMemoryNotificationServices } from './services/notifications/memory';
import { createDbPreferenceServices } from './services/preferences/db';
import { createMemoryPreferenceServices } from './services/preferences/memory';
import { createDbRegionServices } from './services/regions/db';
import { createMemoryRegionServices } from './services/regions/memory';
import { createDbSubscriptionServices } from './services/subscriptions/db';
import { createMemorySubscriptionServices } from './services/subscriptions/memory';
import { createMemoryStore } from './services/memory-store';
import { initSentry } from './sentry';

initSentry('api');

const port = Number(process.env.API_PORT ?? 3000);
/** Web (3100), Expo web (8081), and 127.0.0.1 variants. Override with CORS_ORIGINS. */
const DEFAULT_DEV_CORS =
  'http://localhost:3100,http://127.0.0.1:3100,http://localhost:8081,http://127.0.0.1:8081';
const corsOriginList = (process.env.CORS_ORIGINS ?? DEFAULT_DEV_CORS)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
/**
 * Credentialed CORS cannot use `Access-Control-Allow-Origin: *`. A lone `*` means
 * reflect the request Origin (early AWS before EdgeStack pins known hosts).
 */
const corsOrigin =
  corsOriginList.length === 1 && corsOriginList[0] === '*'
    ? (origin: string) => (origin.length > 0 ? origin : null)
    : corsOriginList;

/** Inline token until SES is wired; set INCLUDE_VERIFICATION_TOKEN=false in prod with mail. */
const includeVerificationToken =
  process.env.INCLUDE_VERIFICATION_TOKEN === 'true' ||
  (process.env.INCLUDE_VERIFICATION_TOKEN !== 'false' && process.env.NODE_ENV !== 'production');

const databaseUrl = resolveDatabaseUrl();
const authEnv = { includeVerificationToken, now: () => new Date() };
const eventEnv = { now: () => new Date() };

const preferenceEnv = { now: () => new Date() };
const queueUrl = process.env.DOMAIN_EVENTS_QUEUE_URL?.trim();
const domainEvents = queueUrl
  ? createSqsDomainEventPublisher({ queueUrl })
  : createMemoryDomainEventPublisher();
const eventEnvWithQueue = { ...eventEnv, domainEvents };

const checkInEnv = { now: () => new Date(), domainEvents };
const { auth, events, preferences, regions, subscriptions, checkIns, notifications } = (() => {
  if (databaseUrl) {
    const db = createDb(databaseUrl);
    const authServices = createDbAuthServices(db, authEnv);
    return {
      auth: authServices,
      events: createDbEventServices(db, authServices, eventEnvWithQueue),
      preferences: createDbPreferenceServices(db, authServices, preferenceEnv),
      regions: createDbRegionServices(db),
      subscriptions: createDbSubscriptionServices(db, authServices),
      checkIns: createDbCheckInServices(db, authServices, checkInEnv),
      notifications: createDbNotificationServices(db, authServices),
    };
  }
  const store = createMemoryStore();
  const authServices = createMemoryAuthServices(authEnv, store);
  return {
    auth: authServices,
    events: createMemoryEventServices(authServices, eventEnvWithQueue, store),
    preferences: createMemoryPreferenceServices(authServices, preferenceEnv, store),
    regions: createMemoryRegionServices(store),
    subscriptions: createMemorySubscriptionServices(authServices, store),
    checkIns: createMemoryCheckInServices(authServices, checkInEnv, store),
    notifications: createMemoryNotificationServices(authServices, store),
  };
})();

if (!queueUrl) {
  console.warn('DOMAIN_EVENTS_QUEUE_URL not set; domain events stay in-process (not durable)');
}

if (!databaseUrl) {
  console.warn('DATABASE_URL not set; using in-memory store (data is lost on restart)');
}

serve(
  {
    fetch: createApp({
      auth,
      events,
      preferences,
      regions,
      subscriptions,
      checkIns,
      notifications,
      corsOrigin,
    }).fetch,
    port,
  },
  (info) => {
    console.log(`api listening on http://localhost:${info.port}`);
  },
);
