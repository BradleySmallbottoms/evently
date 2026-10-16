import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import {
  assertKnownMigrations,
  migrationHash,
  pendingMigrations,
} from './migration-plan.mjs';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const journal = JSON.parse(
  fs.readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
);

const migrations = journal.entries.map((entry) => {
  const sqlText = fs.readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), 'utf8');
  const statements = sqlText
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  return { tag: entry.tag, when: entry.when, hash: migrationHash(sqlText), statements };
});

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://events:events@localhost:15432/events';
const sql = postgres(databaseUrl, { max: 1, onnotice() {} });

try {
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;
  const applied = await sql`select hash, created_at from drizzle.__drizzle_migrations`;
  const appliedHashes = new Set(applied.map((row) => row.hash));
  const appliedWhens = applied.map((row) => Number(row.created_at));
  assertKnownMigrations(migrations, appliedHashes);
  const pending = pendingMigrations(migrations, appliedHashes, appliedWhens);
  if (pending.length === 0) {
    console.log('no pending migrations');
  } else {
    // One transaction per migration. Postgres cannot use an enum value added in the same transaction.
    for (const migration of pending) {
      await sql.begin(async (tx) => {
        for (const statement of migration.statements) {
          await tx.unsafe(statement);
        }
        await tx`
          insert into drizzle.__drizzle_migrations (hash, created_at)
          values (${migration.hash}, ${migration.when})
        `;
      });
      console.log(`applied ${migration.tag}`);
    }
  }
} finally {
  await sql.end();
}
