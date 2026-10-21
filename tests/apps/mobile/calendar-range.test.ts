import { describe, expect, it } from 'vitest';

import {
  addDays,
  boundsIso,
  formatRangeShort,
  monthGrid,
  monthStamps,
  partsInZone,
  weekendStamps,
  zonedDate,
} from '../../../apps/mobile/src/lib/calendar-range';

describe('calendar range', () => {
  it('reads a Stockholm calendar day from an instant', () => {
    expect(partsInZone(new Date('2026-10-17T22:30:00.000Z'))).toEqual({ y: 2026, m: 10, d: 18 });
  });

  it('turns a Stockholm day into UTC bounds', () => {
    expect(zonedDate({ y: 2026, m: 10, d: 18 }, false).toISOString()).toBe(
      '2026-10-17T22:00:00.000Z',
    );
    expect(boundsIso({ y: 2026, m: 10, d: 18 }, { y: 2026, m: 10, d: 18 }).to).toBe(
      '2026-10-18T21:59:59.999Z',
    );
  });

  it('uses the coming Saturday and Sunday', () => {
    expect(weekendStamps({ y: 2026, m: 10, d: 19 })).toEqual({
      from: { y: 2026, m: 10, d: 24 },
      to: { y: 2026, m: 10, d: 25 },
    });
    expect(weekendStamps({ y: 2026, m: 10, d: 25 })).toEqual({
      from: { y: 2026, m: 10, d: 24 },
      to: { y: 2026, m: 10, d: 25 },
    });
  });

  it('builds a Monday-first October grid', () => {
    const cells = monthGrid(2026, 10);
    expect(cells).toHaveLength(35);
    expect(cells[0]).toEqual({ y: 2026, m: 9, d: 28 });
    expect(cells[3]).toEqual({ y: 2026, m: 10, d: 1 });
    expect(monthStamps(2026, 10).to).toEqual({ y: 2026, m: 10, d: 31 });
  });

  it('shortens a range inside one month', () => {
    expect(formatRangeShort({ y: 2026, m: 10, d: 24 }, { y: 2026, m: 10, d: 25 }, 'sv')).toBe(
      '24–25 okt',
    );
    expect(addDays({ y: 2026, m: 10, d: 31 }, 1)).toEqual({ y: 2026, m: 11, d: 1 });
  });
});
