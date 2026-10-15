import { describe, expect, it } from 'vitest';
import { sourceDateTime, stockholmWallTime } from '../../../packages/domain/src/source-time';

describe('sourceDateTime', () => {
  it('keeps a Z timestamp as that UTC instant', () => {
    expect(sourceDateTime('2026-10-28T15:00:00Z')).toBe('2026-10-28T15:00:00.000Z');
  });

  it('keeps a numeric offset as that instant', () => {
    expect(sourceDateTime('2026-07-01T19:00:00+02:00')).toBe('2026-07-01T17:00:00.000Z');
  });

  it('reads a clock with no zone as Stockholm wall time', () => {
    expect(sourceDateTime('2026-10-28T15:00:00')).toBe('2026-10-28T15:00:00+01:00');
    expect(sourceDateTime('2026-07-01T19:00:00')).toBe('2026-07-01T19:00:00+02:00');
  });

  it('rejects a value that is not a datetime', () => {
    expect(() => sourceDateTime('next friday')).toThrow(/not a datetime/);
  });
});

describe('stockholmWallTime', () => {
  it('writes a local period with the Stockholm offset', () => {
    expect(stockholmWallTime({ year: 2026, month: 10, day: 30, hour: 17, minute: 0 })).toBe(
      '2026-10-30T17:00:00+01:00',
    );
  });
});
