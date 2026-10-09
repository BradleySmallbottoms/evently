import { createMemoryStore, type MemoryStore } from '../memory-store';
import type { RegionServices } from './types';

function covers(
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  lat: number,
  lng: number,
): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

export function createMemoryRegionServices(
  store: MemoryStore = createMemoryStore(),
): RegionServices {
  return {
    async lookup(query) {
      const matches = [...store.regions.values()].filter((r) =>
        covers(r.bbox, query.lat, query.lng),
      );
      matches.sort((a, b) => (a.kind === 'municipality' ? 0 : 1) - (b.kind === 'municipality' ? 0 : 1));
      const best = matches[0];
      return {
        region: best
          ? { id: best.id, name: best.name, kind: best.kind, code: best.code }
          : null,
      };
    },
  };
}
