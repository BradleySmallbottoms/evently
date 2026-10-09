import { describe, expect, it } from 'vitest';
import { resolveDatabaseUrl } from './index';

describe('resolveDatabaseUrl', () => {
  it('prefers DATABASE_URL', () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: 'postgres://a:b@localhost:5432/events',
        DB_HOST: 'ignored',
      }),
    ).toBe('postgres://a:b@localhost:5432/events');
  });

  it('assembles and encodes discrete DB_* fields', () => {
    expect(
      resolveDatabaseUrl({
        DB_HOST: 'db.example',
        DB_PORT: '5432',
        DB_USER: 'events',
        DB_PASSWORD: 'p@ss:word/x',
        DB_NAME: 'events',
      }),
    ).toBe(
      'postgres://events:p%40ss%3Aword%2Fx@db.example:5432/events?sslmode=require',
    );
  });

  it('returns undefined when incomplete', () => {
    expect(resolveDatabaseUrl({ DB_HOST: 'db.example' })).toBeUndefined();
  });
});
