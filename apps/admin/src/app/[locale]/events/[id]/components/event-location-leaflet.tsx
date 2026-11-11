'use client';

import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { cn } from 'cn';
import 'leaflet/dist/leaflet.css';
import {
  DEFAULT_MAP_CENTER,
  formatMapCoordinate,
  geofenceMeters,
  mapPoint,
  type EventLocationMapProps,
  type MapPoint,
} from './event-location';

const pin = L.divIcon({
  className: 'event-location-pin',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  html: `<span style="display:block;box-sizing:border-box;width:28px;height:28px;border-radius:9999px;background:#171717;border:3px solid #fff;box-shadow:0 1px 4px rgb(0 0 0 / 45%)"></span>`,
});

function Frame({
  point,
  radiusM,
  idle,
}: {
  point: MapPoint | null;
  radiusM: number | null;
  /** Both coordinate fields are empty, so the map shows the launch area. */
  idle: boolean;
}) {
  const map = useMap();
  const pointKey = point ? `${point.lat.toFixed(6)},${point.lng.toFixed(6)}` : '';
  const radiusKey = radiusM == null ? '' : String(radiusM);
  const framed = useRef('');

  useEffect(() => {
    const container = map.getContainer();
    const apply = () => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      map.invalidateSize();
      const key = `${pointKey}|${radiusKey}|${idle ? 'idle' : ''}`;
      if (framed.current === key) return;
      framed.current = key;
      if (!point) {
        if (idle) map.setView([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], 11);
        return;
      }
      if (radiusM != null) {
        map.fitBounds(L.latLng(point.lat, point.lng).toBounds(radiusM * 2), {
          padding: [24, 24],
          maxZoom: 16,
        });
        return;
      }
      map.setView([point.lat, point.lng], 15);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(container);
    return () => observer.disconnect();
  }, [idle, map, point, pointKey, radiusKey, radiusM]);

  return null;
}

function PlaceOnClick({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      const target = event.originalEvent.target;
      if (target instanceof Element && target.closest('.leaflet-control')) return;
      onPlace(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

/** OpenStreetMap view of one occasion's point. A supplied `onPlace` lets a click or drag move it. */
export function EventLocationLeaflet({ lat, lng, radiusM, onPlace }: EventLocationMapProps) {
  const pinned = useMemo(() => mapPoint(lat, lng), [lat, lng]);
  const radius = geofenceMeters(radiusM);
  const idle = lat.trim() === '' && lng.trim() === '';
  const center = pinned ?? DEFAULT_MAP_CENTER;

  return (
    <div
      className={cn(
        'absolute inset-0 [&_.leaflet-container]:h-full [&_.leaflet-container]:w-full [&_.event-location-pin]:border-none [&_.event-location-pin]:bg-transparent',
        onPlace && '[&_.leaflet-container]:cursor-crosshair',
      )}
    >
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={pinned ? 15 : 11}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <Frame point={pinned} radiusM={radius} idle={idle} />
        {onPlace ? (
          <PlaceOnClick
            onPlace={(nextLat, nextLng) =>
              onPlace(formatMapCoordinate(nextLat), formatMapCoordinate(nextLng))
            }
          />
        ) : null}
        {pinned && radius != null ? (
          <Circle
            center={[pinned.lat, pinned.lng]}
            radius={radius}
            pathOptions={{
              color: 'var(--primary)',
              fillColor: 'var(--primary)',
              fillOpacity: 0.15,
              weight: 2,
            }}
          />
        ) : null}
        {pinned ? (
          <CircleMarker
            center={[pinned.lat, pinned.lng]}
            radius={9}
            pathOptions={{ color: '#fff', weight: 3, fillColor: '#171717', fillOpacity: 1 }}
          />
        ) : null}
        {pinned ? (
          <Marker
            position={[pinned.lat, pinned.lng]}
            icon={pin}
            draggable={onPlace != null}
            zIndexOffset={500}
            eventHandlers={
              onPlace
                ? {
                    dragend(event) {
                      const marker = event.target as L.Marker;
                      const next = marker.getLatLng();
                      onPlace(formatMapCoordinate(next.lat), formatMapCoordinate(next.lng));
                    },
                  }
                : undefined
            }
          />
        ) : null}
      </MapContainer>
    </div>
  );
}
