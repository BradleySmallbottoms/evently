import { serve } from '@hono/node-server';
import { createDb, resolveDatabaseUrl } from '@local-events/db';
import { createApp } from './app';
import {
  createDbAdminPublisherServices,
  createMemoryAdminPublisherServices,
} from './services/publishers';
import { initSentry } from './sentry';

initSentry('admin-api');

const port = Number(process.env.ADMIN_API_PORT ?? 3001);
const databaseUrl = resolveDatabaseUrl();
const publishers = databaseUrl
  ? createDbAdminPublisherServices(createDb(databaseUrl))
  : createMemoryAdminPublisherServices({ publishers: new Map(), events: new Map() });

if (!databaseUrl) {
  console.warn('DATABASE_URL not set; admin-api using empty in-memory publisher store');
}

serve({ fetch: createApp({ publishers }).fetch, port }, (info) => {
  console.log(`admin-api listening on http://localhost:${info.port}`);
});
