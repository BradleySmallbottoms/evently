import { serve } from '@hono/node-server';
import { createDb, resolveDatabaseUrl } from '@local-events/db';
import { createApp } from './app';
import { createDbAuthServices } from './auth/db';
import { createMemoryAuthServices } from './auth/memory';
import { initSentry } from './sentry';

initSentry('api');

const port = Number(process.env.API_PORT ?? 3000);
const isProduction = process.env.NODE_ENV === 'production';
/** Web (3100), Expo web (8081), and 127.0.0.1 variants. Override with CORS_ORIGINS. */
const DEFAULT_DEV_CORS =
  'http://localhost:3100,http://127.0.0.1:3100,http://localhost:8081,http://127.0.0.1:8081';
const corsOrigins = (process.env.CORS_ORIGINS ?? DEFAULT_DEV_CORS)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const databaseUrl = resolveDatabaseUrl();
const auth = databaseUrl
  ? createDbAuthServices(createDb(databaseUrl), { isProduction, now: () => new Date() })
  : createMemoryAuthServices({ isProduction, now: () => new Date() });

if (!databaseUrl) {
  console.warn('DATABASE_URL not set; using in-memory auth store (data is lost on restart)');
}

serve(
  {
    fetch: createApp({ auth, corsOrigins }).fetch,
    port,
  },
  (info) => {
    console.log(`api listening on http://localhost:${info.port}`);
  },
);
