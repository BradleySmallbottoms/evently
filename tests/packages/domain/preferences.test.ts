import { describe, expect, it } from 'vitest';
import {
  AREA_RADIUS_PRESETS_M,
  canAddSavedArea,
  MAX_AREA_RADIUS_M,
  MAX_SAVED_AREAS,
  MIN_AREA_RADIUS_M,
  validateCircleArea,
  validatePolygonArea,
} from '../../../packages/domain/src/preferences';

describe('AREA_RADIUS_PRESETS_M', () => {
  it('stays inside the saved-circle range', () => {
    expect(AREA_RADIUS_PRESETS_M).toEqual([5_000, 25_000, 50_000, 100_000]);
    for (const radiusM of AREA_RADIUS_PRESETS_M) {
      expect(radiusM).toBeGreaterThanOrEqual(MIN_AREA_RADIUS_M);
      expect(radiusM).toBeLessThanOrEqual(MAX_AREA_RADIUS_M);
    }
  });
});

describe('canAddSavedArea', () => {
  it('caps at MAX_SAVED_AREAS', () => {
    expect(canAddSavedArea(0)).toBe(true);
    expect(canAddSavedArea(MAX_SAVED_AREAS - 1)).toBe(true);
    expect(canAddSavedArea(MAX_SAVED_AREAS)).toBe(false);
  });
});

describe('validateCircleArea', () => {
  it('accepts launch-range radii', () => {
    expect(
      validateCircleArea({ center: { lat: 61.3, lng: 17.05 }, radiusM: 15_000 }),
    ).toEqual({ ok: true });
  });
  it('rejects out-of-range radii', () => {
    expect(
      validateCircleArea({ center: { lat: 61.3, lng: 17.05 }, radiusM: 100 }),
    ).toEqual({ ok: false, reason: 'radius_out_of_range' });
  });
});

describe('validatePolygonArea', () => {
  it('requires at least three vertices', () => {
    expect(validatePolygonArea({ polygon: [{ lat: 1, lng: 2 }] })).toEqual({
      ok: false,
      reason: 'polygon_too_small',
    });
    expect(
      validatePolygonArea({
        polygon: [
          { lat: 1, lng: 2 },
          { lat: 1.1, lng: 2 },
          { lat: 1.1, lng: 2.1 },
        ],
      }),
    ).toEqual({ ok: true });
  });
});
