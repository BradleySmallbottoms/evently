import { useQuery } from '@tanstack/react-query';

import { placeNameCell } from './nearby-place-name';
import { placeNameAt } from './place-lookup';

/** Covering place name for the device fix. Null until a name is known. */
export function useNearbyPlaceName(point: { lat: number; lng: number } | null | undefined) {
  const cell = point ? placeNameCell(point.lat, point.lng) : null;
  return useQuery({
    queryKey: ['nearby-place-name', cell?.lat, cell?.lng] as const,
    enabled: cell != null,
    staleTime: 30 * 60 * 1000,
    queryFn: ({ queryKey }) => {
      const lat = queryKey[1];
      const lng = queryKey[2];
      if (lat == null || lng == null) return null;
      return placeNameAt(lat, lng);
    },
  });
}
