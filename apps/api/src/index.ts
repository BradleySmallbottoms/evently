import { serve } from '@hono/node-server';
import { createDb, resolveDatabaseUrl } from '@local-events/db';
import { createApp } from './app';
import { createDbAuthServices } from './services/auth/db';
import { createMemoryAuthServices } from './services/auth/memory';
import { createDbCheckInServices } from './services/check-ins/db';
import { createMemoryCheckInServices } from './services/check-ins/memory';
import { createDbEventContentServices } from './services/event-content/db';
import { createMemoryEventContentServices } from './services/event-content/memory';
import { createDbEventServices } from './services/events/db';
import { createMemoryEventServices } from './services/events/memory';
import { createDbRatingServices } from './services/ratings/db';
import { createDbReportServices } from './services/reports/db';
import { createMemoryReportServices } from './services/reports/memory';
import { createMemoryRatingServices } from './services/ratings/memory';
import { createDbStatsServices } from './services/stats/db';
import { createMemoryStatsServices } from './services/stats/memory';
import { createMemoryDomainEventPublisher } from './services/domain-events/memory';
import { createSqsDomainEventPublisher } from './services/domain-events/sqs';
import { createDbNotificationServices } from './services/notifications/db';
import { createMemoryNotificationServices } from './services/notifications/memory';
import { createDbPreferenceServices } from './services/preferences/db';
import { createMemoryPreferenceServices } from './services/preferences/memory';
import { createDbRegionServices } from './services/regions/db';
import { createMemoryRegionServices } from './services/regions/memory';
import { createDbLibraryServices } from './services/library/db';
import { createMemoryLibraryServices } from './services/library/memory';
import { createDbSubscriptionServices } from './services/subscriptions/db';
import { createMemorySubscriptionServices } from './services/subscriptions/memory';
import { createMemoryPublisherPushMessageServices } from './services/push-messages/memory';
import { createDbPublisherPushMessageServices } from './services/push-messages/publisher';
import { createMemoryStore } from './services/memory-store';
import { createAnthropicTipModel } from './services/tips/anthropic';
import { createDbTipServices } from './services/tips/db';
import { createMemoryTipServices } from './services/tips/memory';
import { initSentry } from './sentry';

initSentry('api');

const port = Number(process.env.API_PORT ?? 13000);
/** Web (13100), Expo web (18081), and 127.0.0.1 variants. Override with CORS_ORIGINS. */
const DEFAULT_DEV_CORS =
  'http://localhost:13100,http://127.0.0.1:13100,http://localhost:18081,http://127.0.0.1:18081';
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
const eventEnv = {
  now: () => new Date(),
  assetsPublicBaseUrl: process.env.ASSETS_PUBLIC_BASE_URL?.trim() || undefined,
};

const preferenceEnv = { now: () => new Date() };
const queueUrl = process.env.DOMAIN_EVENTS_QUEUE_URL?.trim();
const domainEvents = queueUrl
  ? createSqsDomainEventPublisher({ queueUrl })
  : createMemoryDomainEventPublisher();
const eventEnvWithQueue = { ...eventEnv, domainEvents };

const checkInEnv = { now: () => new Date(), domainEvents };
const contentEnv = { now: () => new Date() };
const {
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
  reports,
  stats,
  pushMessages,
  tips,
} = (() => {
  if (databaseUrl) {
    const db = createDb(databaseUrl);
    const authServices = createDbAuthServices(db, authEnv);
    return {
      auth: authServices,
      events: createDbEventServices(db, authServices, eventEnvWithQueue),
      preferences: createDbPreferenceServices(db, authServices, preferenceEnv),
      regions: createDbRegionServices(db),
      subscriptions: createDbSubscriptionServices(db, authServices),
      library: createDbLibraryServices(db, authServices, { ...eventEnv, domainEvents }),
      checkIns: createDbCheckInServices(db, authServices, checkInEnv),
      notifications: createDbNotificationServices(db, authServices),
      eventContent: createDbEventContentServices(db, authServices, contentEnv),
      ratings: createDbRatingServices(db, authServices, checkInEnv),
      reports: createDbReportServices(db, authServices),
      stats: createDbStatsServices(db, authServices, {
        workerToken: process.env.STATS_WORKER_TOKEN?.trim(),
      }),
      pushMessages: createDbPublisherPushMessageServices(db, authServices),
      tips: createDbTipServices(db, authServices, createAnthropicTipModel(), {
        domainEvents,
        assetsPublicBaseUrl: eventEnv.assetsPublicBaseUrl,
      }),
    };
  }
  const store = createMemoryStore();
  const authServices = createMemoryAuthServices(authEnv, store);
  const statsWorkerToken = process.env.STATS_WORKER_TOKEN?.trim() || 'test-stats-worker-token';
  return {
    auth: authServices,
    events: createMemoryEventServices(authServices, eventEnvWithQueue, store),
    preferences: createMemoryPreferenceServices(authServices, preferenceEnv, store),
    regions: createMemoryRegionServices(store),
    subscriptions: createMemorySubscriptionServices(authServices, store),
    library: createMemoryLibraryServices(authServices, store, { domainEvents }),
    checkIns: createMemoryCheckInServices(authServices, checkInEnv, store),
    notifications: createMemoryNotificationServices(authServices, store),
    eventContent: createMemoryEventContentServices(authServices, contentEnv, store),
    ratings: createMemoryRatingServices(authServices, checkInEnv, store),
    reports: createMemoryReportServices(authServices, store),
    stats: createMemoryStatsServices(authServices, store, { workerToken: statsWorkerToken }),
    pushMessages: createMemoryPublisherPushMessageServices(authServices, store),
    tips: createMemoryTipServices(authServices, createAnthropicTipModel(), {
      domainEvents,
      assetsPublicBaseUrl: eventEnv.assetsPublicBaseUrl,
    }),
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
      library,
      checkIns,
      notifications,
      eventContent,
      ratings,
      reports,
      stats,
      pushMessages,
      tips,
      corsOrigin,
      assetsPublicBaseUrl: eventEnv.assetsPublicBaseUrl,
    }).fetch,
    port,
  },
  (info) => {
    console.log(`api listening on http://localhost:${info.port}`);
  },
);
