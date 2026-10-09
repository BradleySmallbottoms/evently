import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export { schema };
export {
  pointEwkt,
  polygonEwkt,
  geographyPoint,
  geographyPolygon,
  geographyMultiPolygon,
} from './postgis';

/**
 * Prefer DATABASE_URL. In ECS we inject discrete DB_* fields from the RDS secret
 * and assemble a URL here (passwords may contain characters that need encoding).
 */
export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const host = env.DB_HOST;
  const user = env.DB_USER;
  const password = env.DB_PASSWORD;
  const database = env.DB_NAME;
  if (!host || !user || !password || !database) return undefined;
  const port = env.DB_PORT ?? '5432';
  // RDS requires TLS (force_ssl); local Docker uses DATABASE_URL without sslmode.
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}?sslmode=require`;
}

export function createDb(url = resolveDatabaseUrl()) {
  if (!url) throw new Error('DATABASE_URL is not set (or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME)');
  const client = postgres(url, { max: 10 });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
