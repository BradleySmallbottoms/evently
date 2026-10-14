import { describe, expect, it } from 'vitest';
import {
  assertKnownMigrations,
  migrationHash,
  pendingMigrations,
  stampNewEntries,
} from '../../../packages/db/scripts/migration-plan.mjs';

describe('migration plan', () => {
  it('hashes the file text the way drizzle records it', () => {
    expect(migrationHash('select 1;\n')).toHaveLength(64);
  });

  it('skips a file whose timestamp was already recorded even when the hash changed', () => {
    const migrations = [
      { tag: '0016', hash: 'new', when: 1791585865487 },
      { tag: '0031', hash: 'b', when: 1791924687247 },
    ];
    expect(
      pendingMigrations(migrations, new Set(['old']), [1791585865487]).map((item) => item.tag),
    ).toEqual(['0031']);
  });
  it('keeps journal order and skips recorded hashes', () => {
    const migrations = [
      { tag: '0031', hash: 'a' },
      { tag: '0037', hash: 'b' },
      { tag: '0039', hash: 'c' },
    ];
    expect(pendingMigrations(migrations, new Set(['c'])).map((item) => item.tag)).toEqual([
      '0031',
      '0037',
    ]);
  });

  it('refuses to apply when no recorded hash matches these files', () => {
    expect(() => assertKnownMigrations([{ hash: 'a' }], new Set(['z']))).toThrow(/Refusing/);
    expect(() => assertKnownMigrations([{ hash: 'a' }], new Set())).not.toThrow();
  });

  it('stamps a new entry after the latest existing timestamp', () => {
    const entries = [
      { tag: '0038', when: 1794200000000 },
      { tag: '0039', when: 1794300000000 },
      { tag: '0040', when: 1791980000000 },
    ];
    expect(stampNewEntries(entries, ['0038', '0039'])).toEqual(['0040']);
    expect(entries[2]?.when).toBe(1794300000001);
  });

  it('leaves a new entry alone when its timestamp is already later', () => {
    const entries = [
      { tag: '0039', when: 100 },
      { tag: '0040', when: 200 },
    ];
    expect(stampNewEntries(entries, ['0039'])).toEqual([]);
    expect(entries[1]?.when).toBe(200);
  });
});