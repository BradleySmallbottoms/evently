import type { UserPreferencesResponse } from '@local-events/contracts';
import { DEFAULT_AREA_RADIUS_M } from '@local-events/domain';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { StoredIdentity } from '@/lib/identity';
import type { NamedPlace } from '@/lib/place-lookup';
import { createCircleArea, updateAreaTags } from '@/lib/preferences';
import { setDiscoveryPlaceId } from '@/lib/use-discovery-point';

export type AreaTagTarget = { id: string; name: string };

function writeAreaTags(
  queryClient: QueryClient,
  userId: string,
  areaId: string,
  tagIds: string[],
) {
  queryClient.setQueryData<UserPreferencesResponse>(['preferences', userId], (current) => {
    if (!current) return current;
    return {
      ...current,
      areas: current.areas.map((area) => (area.id === areaId ? { ...area, tagIds } : area)),
    };
  });
}

/** Create a saved area, then ask which onboarding groups belong to it. */
export function useAreaTagPrompt(identity: StoredIdentity | undefined) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<AreaTagTarget | null>(null);
  const [busy, setBusy] = useState(false);

  async function createFromPlace(place: NamedPlace) {
    if (!identity) throw new Error('missing_identity');
    const area = await createCircleArea(identity, {
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      radiusM: DEFAULT_AREA_RADIUS_M,
    });
    queryClient.setQueryData<UserPreferencesResponse>(['preferences', identity.userId], (current) => {
      if (!current) return current;
      if (current.areas.some((item) => item.id === area.id)) return current;
      return { ...current, areas: [...current.areas, area] };
    });
    // Let the location sheet finish dismissing before this sheet is presented.
    setTimeout(() => setTarget({ id: area.id, name: area.name }), 400);
  }

  function promptForArea(area: AreaTagTarget) {
    setTarget(area);
  }

  async function commit(tagIds: string[], select: boolean) {
    if (!identity || !target) return;
    setBusy(true);
    try {
      await updateAreaTags(identity, target.id, tagIds);
      writeAreaTags(queryClient, identity.userId, target.id, tagIds);
      if (select) await setDiscoveryPlaceId(target.id);
      setTarget(null);
    } finally {
      setBusy(false);
    }
  }

  return {
    target,
    busy,
    createFromPlace,
    promptForArea,
    save: (tagIds: string[]) => commit(tagIds, true),
    skip: () => commit([], true),
    dismiss: () => {
      if (!busy) setTarget(null);
    },
  };
}

export function cacheAreaTags(
  queryClient: QueryClient,
  userId: string,
  areaId: string,
  tagIds: string[],
) {
  writeAreaTags(queryClient, userId, areaId, tagIds);
}
