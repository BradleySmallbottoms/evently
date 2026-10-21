import { describe, expect, it } from 'vitest';

import {
  foundTipClock,
  foundTipDay,
  nearestTipClock,
} from '../../../apps/mobile/src/lib/tip-clock';

describe('nearestTipClock', () => {
  it('starts at 18:00 when the time is missing', () => {
    expect(nearestTipClock('')).toBe('18:00');
    expect(nearestTipClock(null)).toBe('18:00');
  });

  it('reads a found start date and its Stockholm clock', () => {
    expect(foundTipDay('2026-10-24')).toBe('2026-10-24');
    expect(foundTipClock('2026-10-24')).toBeNull();
    expect(foundTipDay('2026-10-24T19:30:00')).toBe('2026-10-24');
    expect(foundTipClock('2026-10-24T19:30:00')).toBe('19:30');
    expect(foundTipDay('2026-10-24T17:00:00.000Z')).toBe('2026-10-24');
    expect(foundTipClock('2026-10-24T17:00:00.000Z')).toBe('19:00');
  });

  it('snaps to the nearest five minutes', () => {
    expect(nearestTipClock('19:07')).toBe('19:05');
    expect(nearestTipClock('19:08')).toBe('19:10');
    expect(nearestTipClock('23:58')).toBe('00:00');
  });
});
