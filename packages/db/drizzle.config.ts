import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://events:events@localhost:5432/events',
  },
  // PostGIS creates its own tables/views; keep them out of diffs.
  extensionsFilters: ['postgis'],
});
