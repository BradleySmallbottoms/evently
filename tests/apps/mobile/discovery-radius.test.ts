import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DISCOVERY_RADIUS_M,
  parseDiscoveryRadiusM,
  resolveDiscoveryRadiusM,
} from '../../../apps/mobile/src/lib/discovery-radius';

describe('discovery search radius', () => {
  it('keeps the 50 km default when nothing is stored', () => {
    expect(parseDiscoveryRadiusM(null)).toBe(DEFAULT_DISCOVERY_RADIUS_M);
    expect(parseDiscoveryRadiusM('')).toBe(DEFAULT_DISCOVERY_RADIUS_M);
    expect(parseDiscoveryRadiusM('nope')).toBe(DEFAULT_DISCOVERY_RADIUS_M);
  });

  it('snaps a stored value onto a slider stop', () => {
    expect(parseDiscoveryRadiusM('12000')).toBe(10_000);
    expect(resolveDiscoveryRadiusM(50_000)).toBe(50_000);
    expect(resolveDiscoveryRadiusM(1_000)).toBe(1_000);
  });
});
