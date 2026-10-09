import { serve } from '@hono/node-server';
import { createDb, resolveDatabaseUrl } from '@local-events/db';
import { createApp } from './app';
import { createDbAuthServices } from './auth/db';
import { createMemoryAuthServices } from './auth/memory';
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
const auth = databaseUrl
  ? createDbAuthServices(createDb(databaseUrl), {
      includeVerificationToken,
      now: () => new Date(),
    })
  : createMemoryAuthServices({ includeVerificationToken, now: () => new Date() });

if (!databaseUrl) {
  console.warn('DATABASE_URL not set; using in-memory auth store (data is lost on restart)');
}

serve(
  {
    fetch: createApp({ auth, corsOrigin }).fetch,
    port,
  },
  (info) => {
    console.log(`api listening on http://localhost:${info.port}`);
  },
);
