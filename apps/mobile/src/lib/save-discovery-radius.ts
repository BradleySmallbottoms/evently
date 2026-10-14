import type { UserPreferencesResponse } from '@local-events/contracts';
import { useQueryClient } from '@tanstack/react-query';

import type { StoredIdentity } from './identity';
import { updateAreaSearchRadius, updateDiscoveryRadius } from './preferences';
import { setDiscoveryRadiusForPlace } from './discovery-radius-store';
import { NEARBY_PLACE_ID } from './use-discovery-point';

function writeNearbyRadius(
  current: UserPreferencesResponse,
  radiusM: number,
): UserPreferencesResponse {
  return { ...current, discoveryRadiusM: radiusM };
}

function writeAreaRadius(
  current: UserPreferencesResponse,
  areaId: string,
  radiusM: number,
): UserPreferencesResponse {
  return {
    ...current,
    areas: current.areas.map((area) =>
      area.id === areaId ? { ...area, searchRadiusM: radiusM } : area,
    ),
  };
}

/** Remember the location-menu radius on the device and on the user. */
export function useSaveDiscoveryRadius(identity: StoredIdentity | undefined) {
  const queryClient = useQueryClient();
  return (radiusM: number, placeId: string) => {
    void setDiscoveryRadiusForPlace(placeId, radiusM);
    if (!identity) return;
    const key = ['preferences', identity.userId] as const;
    if (placeId === NEARBY_PLACE_ID) {
      queryClient.setQueryData<UserPreferencesResponse>(key, (current) =>
        current ? writeNearbyRadius(current, radiusM) : current,
      );
      void updateDiscoveryRadius(identity, radiusM).catch((err: unknown) => {
        console.warn('discovery radius save failed', err);
      });
      return;
    }
    queryClient.setQueryData<UserPreferencesResponse>(key, (current) =>
      current ? writeAreaRadius(current, placeId, radiusM) : current,
    );
    void updateAreaSearchRadius(identity, placeId, radiusM).catch((err: unknown) => {
      console.warn('area search radius save failed', err);
    });
  };
}
