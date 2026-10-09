import { serve } from '@hono/node-server';
import { createDb, resolveDatabaseUrl } from '@local-events/db';
import { createApp } from './app';
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

const publishers = databaseUrl
  ? createDbAdminPublisherServices(createDb(databaseUrl), { domainEvents })
  : createMemoryAdminPublisherServices(
      { publishers: new Map(), events: new Map() },
      { domainEvents },
    );

if (!databaseUrl) {
  console.warn('DATABASE_URL not set; admin-api using empty in-memory publisher store');
}
if (!queueUrl) {
  console.warn('DOMAIN_EVENTS_QUEUE_URL not set; domain events stay in-process (not durable)');
}

serve({ fetch: createApp({ publishers }).fetch, port }, (info) => {
  console.log(`admin-api listening on http://localhost:${info.port}`);
});
