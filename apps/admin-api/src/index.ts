import { serve } from '@hono/node-server';
import { createDb, resolveDatabaseUrl } from '@local-events/db';
import { createApp } from './app';
import { createDbAdminAuthServices } from './services/auth/db';
import {
  createAdminMemoryAuthStore,
  createMemoryAdminAuthServices,
} from './services/auth/memory';
import { createMemoryDomainEventPublisher } from './services/domain-events/memory';
import { createSqsDomainEventPublisher } from './services/domain-events/sqs';
import {
  createDbAdminPublisherServices,
  createMemoryAdminPublisherServices,
} from './services/publishers';
import { initSentry } from './sentry';

initSentry('admin-api');

const port = Number(process.env.ADMIN_API_PORT ?? 3001);
const databaseUrl = resolveDatabaseUrl();
const queueUrl = process.env.DOMAIN_EVENTS_QUEUE_URL?.trim();
const domainEvents = queueUrl
  ? createSqsDomainEventPublisher({ queueUrl })
  : createMemoryDomainEventPublisher();

const DEFAULT_DEV_CORS =
  'http://localhost:3200,http://127.0.0.1:3200';
const corsOriginList = (process.env.ADMIN_CORS_ORIGINS ?? DEFAULT_DEV_CORS)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const corsOrigin =
  corsOriginList.length === 1 && corsOriginList[0] === '*'
    ? (origin: string) => (origin.length > 0 ? origin : null)
    : corsOriginList;

const authStore = createAdminMemoryAuthStore();
const {
  auth,
  publishers,
} = (() => {
  if (databaseUrl) {
    const db = createDb(databaseUrl);
    return {
      auth: createDbAdminAuthServices(db),
      publishers: createDbAdminPublisherServices(db, { domainEvents }),
    };
  }
  return {
    auth: createMemoryAdminAuthServices(authStore),
    publishers: createMemoryAdminPublisherServices(
      { publishers: new Map(), events: new Map() },
      { domainEvents },
    ),
  };
})();

if (!databaseUrl) {
  console.warn('DATABASE_URL not set; admin-api using empty in-memory stores');
}
if (!queueUrl) {
  console.warn('DOMAIN_EVENTS_QUEUE_URL not set; domain events stay in-process (not durable)');
}

const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
if (bootstrapEmail && bootstrapPassword && auth.ensureBootstrapAdmin) {
  void auth.ensureBootstrapAdmin({ email: bootstrapEmail, password: bootstrapPassword }).then(
    (r) => {
      if (r.created) {
        console.log(
          JSON.stringify({
            adminBootstrap: 'created',
            email: bootstrapEmail,
            note: 'enroll TOTP on first login',
          }),
        );
      }
    },
  );
}

serve(
  {
    fetch: createApp({ auth, publishers, corsOrigin }).fetch,
    port,
  },
  (info) => {
    console.log(`admin-api listening on http://localhost:${info.port}`);
  },
);
