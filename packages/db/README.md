# @local-events/db

Drizzle schema, migrations and PostGIS helpers.

```bash
pnpm db:up          # from the repo root: Postgres + PostGIS + Valkey in Docker
pnpm db:generate    # create a migration from src/schema.ts changes
pnpm db:migrate     # apply migrations to DATABASE_URL
```

- Geography columns are SRID 4326. Write EWKT with `pointEwkt()`; query with `ST_DWithin` /
  `ST_Covers` in SQL.
- Migration `0000_extensions` creates `postgis`, `pg_trgm` and `pgcrypto` (RDS supports all
  three); `0001_init` holds the starter tables. Both were applied and tested against PostGIS 3.4.
- Geography columns are created as plain `geography` (see `src/postgis.ts` for why).
- The schema is a starter subset; see `docs/project-description.md` → Data model for the full list.
