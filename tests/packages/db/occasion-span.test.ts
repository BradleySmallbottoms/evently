import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  occasionEndsAtSql,
  occasionStartsAtSql,
  occasionVenueNameSql,
} from '../../../packages/db/src/occasion-span';

const { PgDialect } = createRequire(new URL('../../../packages/db/package.json', import.meta.url))(
  'drizzle-orm/pg-core',
) as {
  PgDialect: new () => { sqlToQuery(query: unknown): { sql: string } };
};

const dialect = new PgDialect();

describe('occasion span sql', () => {
  it('keeps the event id qualified inside the occasion subquery', () => {
    for (const query of [occasionStartsAtSql(), occasionEndsAtSql(), occasionVenueNameSql()]) {
      const compiled = dialect.sqlToQuery(query).sql;
      expect(compiled).toContain('eo.event_id = events.id');
    }
  });

  it('can keep only occasions that start after an instant', () => {
    const compiled = dialect.sqlToQuery(
      occasionStartsAtSql(new Date('2026-10-23T00:00:00.000Z')),
    ).sql;
    expect(compiled).toContain('eo.starts_at >');
    expect(compiled).toContain('eo.event_id = events.id');
  });
});
