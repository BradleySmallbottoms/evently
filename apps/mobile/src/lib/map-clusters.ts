import Supercluster, { type ClusterProperties } from 'supercluster';

/** Pins closer than this on screen share one numbered marker. */
const CLUSTER_RADIUS_PX = 64;
/** Past this zoom, each event is its own pin. Same-venue pins then fan out. */
const CLUSTER_MAX_ZOOM = 16;
/** Supercluster measures radius against a 512px world tile. */
const TILE_PX = 512;
/** Ring size so several events at one venue can each be tapped. */
const SPIDER_METERS = 46;

export type MapPoint = { id: string; lat: number; lng: number };

export type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type MapMarker<T extends MapPoint> =
  | { kind: 'event'; id: string; point: T; latitude: number; longitude: number }
  | {
      kind: 'group';
      id: string;
      count: number;
      latitude: number;
      longitude: number;
      /** Region that opens the group. Animating here splits it on the next draw. */
      region: MapRegion;
    };

type PointProps = { id: string };

export type MapClusterIndex<T extends MapPoint> = {
  index: Supercluster<PointProps>;
  byId: Map<string, T>;
};

/** Zoom that matches a map width, in the same units Supercluster clusters with. */
export function zoomForRegion(longitudeDelta: number, widthPx: number): number {
  const delta = Math.min(Math.max(Math.abs(longitudeDelta), 1e-6), 360);
  const width = Math.max(widthPx, 1);
  const zoom = Math.log2((360 * width) / (delta * TILE_PX));
  return Math.max(0, Math.min(20, Math.round(zoom)));
}

function longitudeDeltaForZoom(zoom: number, widthPx: number): number {
  const width = Math.max(widthPx, 1);
  return (360 * width) / (TILE_PX * 2 ** zoom);
}

/** A tighter view centered on a group, at the zoom where it breaks apart. */
export function regionToExpandGroup(
  latitude: number,
  longitude: number,
  from: MapRegion,
  expansionZoom: number,
  widthPx: number,
): MapRegion {
  const currentZoom = zoomForRegion(from.longitudeDelta, widthPx);
  const zoom = Math.min(20, Math.max(currentZoom + 1, expansionZoom));
  const longitudeDelta = Math.min(from.longitudeDelta, longitudeDeltaForZoom(zoom, widthPx));
  const aspect = from.latitudeDelta / Math.max(Math.abs(from.longitudeDelta), 1e-6);
  return {
    latitude,
    longitude,
    longitudeDelta,
    latitudeDelta: longitudeDelta * aspect,
  };
}

function isCluster(properties: object | null): properties is ClusterProperties {
  return !!properties && 'cluster' in properties && properties.cluster === true;
}

function spiderOffset(index: number, count: number, lat: number, lng: number) {
  const angle = (2 * Math.PI * index) / count - Math.PI / 2;
  const meters = Math.min(120, SPIDER_METERS + count * 8);
  const latRad = (lat * Math.PI) / 180;
  const dLat = (meters * Math.sin(angle)) / 111_320;
  const dLng = (meters * Math.cos(angle)) / (111_320 * Math.max(Math.cos(latRad), 0.2));
  return { lat: lat + dLat, lng: lng + dLng };
}

/** Spread events that share a venue so each pin can be tapped once the group has opened. */
function spiderfy<T extends MapPoint>(
  leaves: Array<{ point: T; latitude: number; longitude: number }>,
): Array<{ point: T; latitude: number; longitude: number }> {
  const buckets = new Map<string, typeof leaves>();
  for (const leaf of leaves) {
    const key = `${leaf.point.lat.toFixed(4)},${leaf.point.lng.toFixed(4)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(leaf);
    else buckets.set(key, [leaf]);
  }
  const placed: typeof leaves = [];
  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      placed.push(bucket[0]!);
      continue;
    }
    const ordered = [...bucket].sort((a, b) => a.point.id.localeCompare(b.point.id));
    ordered.forEach((leaf, index) => {
      const shifted = spiderOffset(index, ordered.length, leaf.point.lat, leaf.point.lng);
      placed.push({ point: leaf.point, latitude: shifted.lat, longitude: shifted.lng });
    });
  }
  return placed;
}

export function createMapClusterIndex<T extends MapPoint>(
  points: readonly T[],
): MapClusterIndex<T> {
  const index = new Supercluster<PointProps>({
    radius: CLUSTER_RADIUS_PX,
    maxZoom: CLUSTER_MAX_ZOOM,
    minPoints: 2,
  });
  index.load(
    points.map((point) => ({
      type: 'Feature',
      properties: { id: point.id },
      geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
    })),
  );
  return { index, byId: new Map(points.map((point) => [point.id, point])) };
}

export function markersInRegion<T extends MapPoint>(
  built: MapClusterIndex<T>,
  region: MapRegion,
  widthPx: number,
): MapMarker<T>[] {
  if (built.byId.size === 0) return [];
  const zoom = zoomForRegion(region.longitudeDelta, widthPx);
  const west = region.longitude - region.longitudeDelta / 2;
  const south = region.latitude - region.latitudeDelta / 2;
  const east = region.longitude + region.longitudeDelta / 2;
  const north = region.latitude + region.latitudeDelta / 2;
  const features = built.index.getClusters([west, south, east, north], zoom);

  const groups: MapMarker<T>[] = [];
  const leaves: Array<{ point: T; latitude: number; longitude: number }> = [];
  for (const feature of features) {
    const [lng, lat] = feature.geometry.coordinates;
    if (lng == null || lat == null) continue;
    if (isCluster(feature.properties)) {
      const expansionZoom = built.index.getClusterExpansionZoom(feature.properties.cluster_id);
      groups.push({
        kind: 'group',
        id: `group-${feature.properties.cluster_id}`,
        count: feature.properties.point_count,
        latitude: lat,
        longitude: lng,
        region: regionToExpandGroup(lat, lng, region, expansionZoom, widthPx),
      });
      continue;
    }
    const id = feature.properties?.id;
    if (typeof id !== 'string') continue;
    const point = built.byId.get(id);
    if (!point) continue;
    leaves.push({ point, latitude: lat, longitude: lng });
  }

  return [
    ...groups,
    ...spiderfy(leaves).map((leaf) => ({
      kind: 'event' as const,
      id: leaf.point.id,
      point: leaf.point,
      latitude: leaf.latitude,
      longitude: leaf.longitude,
    })),
  ];
}

export function clusterMapPoints<T extends MapPoint>(
  points: readonly T[],
  region: MapRegion,
  widthPx: number,
): MapMarker<T>[] {
  return markersInRegion(createMapClusterIndex(points), region, widthPx);
}
