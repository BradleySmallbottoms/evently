import { describe, expect, it } from 'vitest';
import { distanceMeters, isWithinRadius } from './index';

const soderhamn = { lat: 61.3037, lng: 17.0592 };
const hudiksvall = { lat: 61.729, lng: 17.1036 };

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters(soderhamn, soderhamn)).toBe(0);
  });
  it('is roughly 47 km between Söderhamn and Hudiksvall', () => {
    const km = distanceMeters(soderhamn, hudiksvall) / 1000;
    expect(km).toBeGreaterThan(45);
    expect(km).toBeLessThan(50);
  });
});

describe('isWithinRadius', () => {
  it('respects the accuracy allowance', () => {
    const near = { lat: soderhamn.lat + 0.0012, lng: soderhamn.lng }; // ~133 m north
    expect(isWithinRadius(near, soderhamn, 100)).toBe(false);
    expect(isWithinRadius(near, soderhamn, 100, 50)).toBe(true);
  });
});
