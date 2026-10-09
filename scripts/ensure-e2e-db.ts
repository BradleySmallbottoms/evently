/**
 * Ensures the disposable Playwright database `events_e2e` exists (same Postgres
 * instance as local `events`) and has the PostGIS extensions. Safe to re-run.
 *
 * Usage: pnpm db:e2e:setup
 */
import postgres from 'postgres';

async function main() {
  const adminUrl =
    process.env.E2E_ADMIN_DATABASE_URL ??
    process.env.DATABASE_URL?.replace(/\/[^/]+$/, '/postgres') ??
    'postgres://events:events@localhost:5432/postgres';
  const e2eUrl =
    process.env.E2E_DATABASE_URL ?? 'postgres://events:events@localhost:5432/events_e2e';

  const dbName = new URL(e2eUrl).pathname.replace(/^\//, '') || 'events_e2e';

  const admin = postgres(adminUrl, { max: 1 });
  try {
    const existing = await admin`
      SELECT 1 FROM pg_database WHERE datname = ${dbName}
    `;
    if (existing.length === 0) {
      // CREATE DATABASE cannot run inside a parameterized query / transaction.
      await admin.unsafe(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
      console.log(`Created database ${dbName}`);
    } else {
      console.log(`Database ${dbName} already exists`);
    }
  } finally {
    await admin.end();
  }

  const e2e = postgres(e2eUrl, { max: 1 });
  try {
    await e2e`CREATE EXTENSION IF NOT EXISTS postgis`;
    await e2e`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    await e2e`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    console.log(`Extensions ready on ${dbName}`);
  } finally {
    await e2e.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
