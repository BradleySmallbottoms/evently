import type { UserArea, UserPreferencesResponse } from '@local-events/contracts';
import { describe, expect, it } from 'vitest';

import { preferencesWithArea } from '../../../apps/mobile/src/lib/home-discovery-cache';

const area = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Söderhamn',
  kind: 'manual',
  origin: 'manual',
  regionId: null,
  center: { lat: 61.3, lng: 17.05 },
  radiusM: 25000,
  searchRadiusM: 25000,
  polygon: null,
  notify: true,
  active: true,
  tagIds: [],
  createdAt: '2026-10-23T08:00:00.000Z',
} satisfies UserArea;

function preferences(areas: UserArea[] = []): UserPreferencesResponse {
  return {
    areas,
    quietHours: { enabled: false, startMin: 0, endMin: 0, timezone: 'Europe/Stockholm' },
    travelDistanceM: 25000,
    discoveryRadiusM: null,
  };
}

describe('preferencesWithArea', () => {
  it('appends a new area and replaces an existing one', () => {
    const created = preferencesWithArea(preferences(), area);
    expect(created?.areas).toEqual([area]);
    const tagged = preferencesWithArea(created, {
      ...area,
      tagIds: ['33333333-3333-4333-8333-333333333333'],
    });
    expect(tagged?.areas).toEqual([{ ...area, tagIds: ['33333333-3333-4333-8333-333333333333'] }]);
  });

  it('does nothing until preferences have loaded', () => {
    expect(preferencesWithArea(undefined, area)).toBeUndefined();
  });
});
