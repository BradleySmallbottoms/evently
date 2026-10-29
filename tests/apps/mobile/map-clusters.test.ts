import { describe, expect, it } from 'vitest';

import {
  clusterMapPoints,
  type MapPoint,
  type MapRegion,
} from '../../../apps/mobile/src/lib/map-clusters';

const WIDTH = 390;

const city: MapRegion = {
  latitude: 61.3,
  longitude: 17.06,
  latitudeDelta: 0.4,
  longitudeDelta: 0.4,
};

const street: MapRegion = {
  latitude: 61.3046,
  longitude: 17.055,
  latitudeDelta: 0.002,
  longitudeDelta: 0.002,
};

function at(id: string, lat: number, lng: number): MapPoint {
  return { id, lat, lng };
}

describe('clusterMapPoints', () => {
  it('groups events at the same place into one numbered pin', () => {
    const markers = clusterMapPoints(
      [at('a', 61.3046, 17.055), at('b', 61.3046, 17.055), at('c', 61.3046, 17.055)],
      city,
      WIDTH,
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ kind: 'group', count: 3 });
  });

  it('groups events that sit close together when the map is zoomed out', () => {
    const markers = clusterMapPoints(
      [at('a', 61.3046, 17.055), at('b', 61.3054, 17.0565)],
      city,
      WIDTH,
    );
    expect(markers).toEqual([expect.objectContaining({ kind: 'group', count: 2 })]);
  });

  it('leaves distant events as their own pins', () => {
    const wide: MapRegion = {
      latitude: 60.3,
      longitude: 17.5,
      latitudeDelta: 4,
      longitudeDelta: 4,
    };
    const markers = clusterMapPoints(
      [at('soderhamn', 61.3, 17.06), at('stockholm', 59.33, 18.07)],
      wide,
      WIDTH,
    );
    expect(markers.map((marker) => marker.kind).sort()).toEqual(['event', 'event']);
  });

  it('opens a same-venue group into separate pins when zoomed in', () => {
    const markers = clusterMapPoints(
      [at('a', 61.3046, 17.055), at('b', 61.3046, 17.055), at('c', 61.3046, 17.055)],
      street,
      WIDTH,
    );
    const events = markers.filter((marker) => marker.kind === 'event');
    expect(events).toHaveLength(3);
    const spots = new Set(
      events.map((marker) => `${marker.latitude.toFixed(5)},${marker.longitude.toFixed(5)}`),
    );
    expect(spots.size).toBe(3);
  });

  it('aims a group tap at a closer view', () => {
    const markers = clusterMapPoints(
      [at('a', 61.3046, 17.055), at('b', 61.3046, 17.055), at('c', 61.3046, 17.055)],
      city,
      WIDTH,
    );
    const group = markers.find((marker) => marker.kind === 'group');
    expect(group?.kind).toBe('group');
    if (group?.kind !== 'group') return;
    expect(group.region.longitudeDelta).toBeLessThan(city.longitudeDelta);
    expect(group.region.latitude).toBeCloseTo(61.3046, 3);
    expect(group.region.longitude).toBeCloseTo(17.055, 3);
  });
});
