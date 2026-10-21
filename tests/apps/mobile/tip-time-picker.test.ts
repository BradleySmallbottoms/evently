import { describe, expect, it } from 'vitest';

import { nearestTipClock } from '../../../apps/mobile/src/lib/tip-clock';

describe('nearestTipClock', () => {
  it('starts at 18:00 when the time is missing', () => {
    expect(nearestTipClock('')).toBe('18:00');
    expect(nearestTipClock(null)).toBe('18:00');
  });

  it('snaps to the nearest five minutes', () => {
    expect(nearestTipClock('19:07')).toBe('19:05');
    expect(nearestTipClock('19:08')).toBe('19:10');
    expect(nearestTipClock('23:58')).toBe('00:00');
  });
});
