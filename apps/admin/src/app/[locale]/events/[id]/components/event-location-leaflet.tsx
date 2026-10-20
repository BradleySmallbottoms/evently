'use client';

import Box from '@mui/material/Box';
import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
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
  iconSize: [32, 42],
  iconAnchor: [16, 42],
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" aria-hidden="true">
    <path fill="var(--mui-palette-primary-main)" d="M16 1C7.7 1 1 7.7 1 16c0 11.2 15 24.2 15 24.2S31 27.2 31 16C31 7.7 24.3 1 16 1z"/>
    <circle fill="#fff" cx="16" cy="15.5" r="5.5"/>
  </svg>`,
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
  const seen = useRef<{ point: string; radius: string } | null>(null);

  useEffect(() => {
    const prev = seen.current;
    seen.current = { point: pointKey, radius: radiusKey };
    map.invalidateSize();
    if (!point) {
      if (idle) map.setView([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], 11);
      return;
    }
    const radiusChanged = !prev || prev.radius !== radiusKey;
    if (radiusChanged && radiusM != null) {
      map.fitBounds(L.latLng(point.lat, point.lng).toBounds(radiusM * 2), {
        padding: [24, 24],
        maxZoom: 16,
      });
      return;
    }
    if (!prev || radiusChanged) {
      map.setView([point.lat, point.lng], 15);
      return;
    }
    if (prev.point !== pointKey) map.panTo([point.lat, point.lng]);
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

/** OpenStreetMap view of the event point. Click or drag the pin to change it. */
export function EventLocationLeaflet({ lat, lng, radiusM, onPlace }: EventLocationMapProps) {
  const pinned = useMemo(() => mapPoint(lat, lng), [lat, lng]);
  const radius = geofenceMeters(radiusM);
  const idle = lat.trim() === '' && lng.trim() === '';
  const center = pinned ?? DEFAULT_MAP_CENTER;

  return (
    <Box
      sx={{
        height: '100%',
        '& .leaflet-container': { height: '100%', width: '100%', cursor: 'crosshair' },
        '& .event-location-pin': { background: 'transparent', border: 'none' },
      }}
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
        <PlaceOnClick
          onPlace={(nextLat, nextLng) =>
            onPlace(formatMapCoordinate(nextLat), formatMapCoordinate(nextLng))
          }
        />
        {pinned && radius != null ? (
          <Circle
            center={[pinned.lat, pinned.lng]}
            radius={radius}
            pathOptions={{
              color: 'var(--mui-palette-primary-main)',
              fillColor: 'var(--mui-palette-primary-main)',
              fillOpacity: 0.15,
              weight: 2,
            }}
          />
        ) : null}
        {pinned ? (
          <Marker
            position={[pinned.lat, pinned.lng]}
            icon={pin}
            draggable
            eventHandlers={{
              dragend(event) {
                const marker = event.target as L.Marker;
                const next = marker.getLatLng();
                onPlace(formatMapCoordinate(next.lat), formatMapCoordinate(next.lng));
              },
            }}
          />
        ) : null}
      </MapContainer>
    </Box>
  );
}
