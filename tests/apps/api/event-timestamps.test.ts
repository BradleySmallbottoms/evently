import { describe, expect, it } from 'vitest';
import { dbTimestamp } from '../../../apps/api/src/services/db-values';

describe('dbTimestamp', () => {
  it('parses a subquery timestamp string', () => {
    const parsed = dbTimestamp('2026-12-01 18:00:00+00');
    expect(parsed?.toISOString()).toBe('2026-12-01T18:00:00.000Z');
  });

  it('keeps a Date from a mapped column', () => {
    const value = new Date('2026-12-01T18:00:00.000Z');
    expect(dbTimestamp(value)).toBe(value);
  });

  it('drops an empty or unreadable value', () => {
    expect(dbTimestamp(null)).toBeNull();
    expect(dbTimestamp('')).toBeNull();
    expect(dbTimestamp('not-a-date')).toBeNull();
  });
});
