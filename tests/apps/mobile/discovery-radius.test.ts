import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DISCOVERY_RADIUS_M,
  discoveryRadiusForPlace,
  parseDiscoveryRadiusM,
  parseDiscoveryRadiusMap,
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

  it('keeps a radius for each place and reads an older single value as Near you', () => {
    expect(parseDiscoveryRadiusMap(null)).toEqual({});
    expect(parseDiscoveryRadiusMap('nope')).toEqual({});
    expect(parseDiscoveryRadiusMap('12000')).toEqual({ nearby: 10_000 });
    expect(parseDiscoveryRadiusMap('{"nearby":50000,"area-1":25000}')).toEqual({
      nearby: 50_000,
      'area-1': 25_000,
    });
    expect(parseDiscoveryRadiusMap('{"area-1":"wide"}')).toEqual({});
  });

  it('uses a saved radius, then the area radius, then 50 km', () => {
    expect(discoveryRadiusForPlace('area-1', { 'area-1': 10_000 }, 25_000)).toBe(10_000);
    expect(discoveryRadiusForPlace('area-1', {}, 12_000)).toBe(10_000);
    expect(discoveryRadiusForPlace('nearby', {}, null)).toBe(DEFAULT_DISCOVERY_RADIUS_M);
  });
});
