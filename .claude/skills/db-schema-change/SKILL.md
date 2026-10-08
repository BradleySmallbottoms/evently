---
name: db-schema-change
description: Change the PostgreSQL/PostGIS database schema with Drizzle in packages/db — add tables, columns, indexes, enums or geography columns and generate migrations. Use this whenever a task needs new or changed tables, columns, indexes, constraints, migrations or seed data, or mentions Drizzle, Postgres, PostGIS or the data model.
---

# Database schema change

1. **Check the model.** `docs/project-description.md` → Data model lists the planned tables and
   fields. Follow it; if the change deviates, update that table too (see `record-decision`).
2. **Edit** `packages/db/src/schema.ts`:
   - ids: `uuid('id').primaryKey().default(sql\`gen_random_uuid()\`)` (pgcrypto is enabled).
   - timestamps: `timestamp(..., { withTimezone: true })`.
   - enums: `pgEnum`, mirrored in `packages/contracts` when exposed by the API.
   - geography: use `geographyPoint` / `geographyPolygon` / `geographyMultiPolygon` from
     `./postgis` (plain `geography`; drizzle-kit quotes constrained type names). Add a GiST index:
     `index('<table>_<col>_gist').using('gist', t.<col>)`.
   - Unique/lookup indexes for every foreign key you query by.
3. **Generate**: `pnpm db:generate` (writes `packages/db/migrations/NNNN_*.sql`). Read the SQL.
   Never edit a migration that has been applied in any environment; add a new one. For SQL drizzle
   can't express (CHECK constraints, triggers, data backfills) use
   `pnpm --filter @local-events/db exec drizzle-kit generate --custom --name <name>`.
4. **Apply locally**: `pnpm db:up && pnpm db:migrate`.
5. **Verify**: `pnpm --filter @local-events/db typecheck`, then `pnpm typecheck` at the root.
   For geo columns, sanity-check with a query (`ST_DWithin`, EWKT `POINT(lng lat)` — longitude first).
6. Privacy: new columns holding location or personal data need a retention note in
   `docs/project-description.md` → Security, and must be included in user export/deletion.
