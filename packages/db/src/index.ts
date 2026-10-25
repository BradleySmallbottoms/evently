import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export { schema };
export { SEED_TAGS, visitTagExternalId, visitTagId, type SeedTag } from './seed-tags';
export {
  pointEwkt,
  polygonEwkt,
  geographyPoint,
  geographyPolygon,
  geographyMultiPolygon,
} from './postgis';
export { markTipPublished } from './tips';
export { occasionEndsAtSql, occasionStartsAtSql, occasionVenueNameSql } from './occasion-span';
export {
  approveOpenPushMessagesForPublisher,
  approvePendingPushMessagesForEvent,
  cancelOpenPushMessages,
  findLatestSentPushMessage,
  findOpenPushMessage,
  insertApprovedEventReminders,
  insertPushMessage,
  updatePushMessage,
  type PushMessageRow,
} from './push-messages';

/**
 * Prefer DATABASE_URL. In ECS we inject discrete DB_* fields from the RDS secret
 * and assemble a URL here (passwords may contain characters that need encoding).
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
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

/**
 * Session advisory lock on its own connection. A pooled connection would drop the
 * lock as soon as the query returned. `release` unlocks and closes that connection.
 * A lock already held by another session returns null.
 */
export async function tryHoldAdvisoryLock(
  databaseUrl: string,
  key1 = 7482,
  key2 = 91033,
): Promise<{ release(): Promise<void> } | null> {
  const sql = postgres(databaseUrl, { max: 1 });
  const rows = await sql<{ locked: boolean }[]>`
    select pg_try_advisory_lock(${key1}, ${key2}) as locked
  `;
  if (!rows[0]?.locked) {
    await sql.end({ timeout: 5 });
    return null;
  }
  return {
    async release() {
      await sql`select pg_advisory_unlock(${key1}, ${key2})`;
      await sql.end({ timeout: 5 });
    },
  };
}

export type Db = ReturnType<typeof createDb>;
