# @local-events/db

Drizzle schema, migrations and PostGIS helpers.

```bash
pnpm db:up          # from the repo root: Postgres + PostGIS + Valkey in Docker
pnpm db:generate    # create a migration from src/schema.ts changes
pnpm db:migrate     # apply migrations to DATABASE_URL
```

- Geography columns are SRID 4326. Write EWKT with `pointEwkt()`; query with `ST_DWithin` /
  `ST_Covers` in SQL.
- Local Docker uses `imresamu/postgis` (multi-arch mirror of `postgis/postgis`) so Apple Silicon
  works; official `postgis/postgis` is amd64-only.
- The initial migration creates `postgis`, `pg_trgm` and `pgcrypto` (RDS supports all three)
  plus the starter tables. Geography columns are plain `geography` (see `src/postgis.ts`).
- The schema is a starter subset; see `docs/project-description.md` → Data model for the full list.
