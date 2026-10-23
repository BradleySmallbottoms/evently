import type { UserArea, UserPreferencesResponse } from '@local-events/contracts';
import type { QueryClient } from '@tanstack/react-query';

export function publishPreferences(
  queryClient: QueryClient,
  userId: string,
  preferences: UserPreferencesResponse,
): void {
  queryClient.setQueryData(['preferences', userId], preferences);
}

export function preferencesWithArea(
  current: UserPreferencesResponse | undefined,
  area: UserArea,
): UserPreferencesResponse | undefined {
  if (!current) return current;
  const areas = current.areas.some((item) => item.id === area.id)
    ? current.areas.map((item) => (item.id === area.id ? area : item))
    : [...current.areas, area];
  return { ...current, areas };
}

export function publishArea(queryClient: QueryClient, userId: string, area: UserArea): void {
  queryClient.setQueryData<UserPreferencesResponse>(['preferences', userId], (current) =>
    preferencesWithArea(current, area),
  );
}

export function publishHomeTagIds(queryClient: QueryClient, tagIds: readonly string[]): void {
  queryClient.setQueryData(['home-tag-ids'], [...tagIds]);
}
