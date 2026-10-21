import { ratingAverage } from '@local-events/domain';
import { API_URL } from './api';
import type { StoredIdentity } from './identity';

type StatEntry = { key: string; value: number };
type StatsList = { items: StatEntry[] };

async function fetchStats(
  sourceType: 'user' | 'event' | 'publisher',
  sourceId: string,
  keys: string[],
  headers?: HeadersInit,
): Promise<Record<string, number>> {
  const params = new URLSearchParams();
  for (const key of keys) params.append('key', key);
  const res = await fetch(`${API_URL}/stats/${sourceType}/${sourceId}?${params}`, {
    headers,
  });
  if (!res.ok) {
    throw new Error(`stats_${res.status}`);
  }
  const body = (await res.json()) as StatsList;
  const map: Record<string, number> = {};
  for (const item of body.items ?? []) map[item.key] = item.value;
  return map;
}

export type EventStatsView = {
  numCheckins: number;
  numRatings: number;
  totalRatingValue: number;
  ratingAverage: number | null;
};

export async function fetchEventStats(eventId: string): Promise<EventStatsView> {
  const map = await fetchStats('event', eventId, ['numCheckins', 'numRatings', 'totalRatingValue']);
  const numCheckins = map.numCheckins ?? 0;
  const numRatings = map.numRatings ?? 0;
  const totalRatingValue = map.totalRatingValue ?? 0;
  return {
    numCheckins,
    numRatings,
    totalRatingValue,
    ratingAverage: ratingAverage(numRatings, totalRatingValue),
  };
}

export async function fetchMyStats(identity: StoredIdentity) {
  const map = await fetchStats('user', identity.userId, ['numEventsAttended', 'numEventsRated'], {
    Authorization: `Bearer ${identity.sessionToken}`,
  });
  return {
    numEventsAttended: map.numEventsAttended ?? 0,
    numEventsRated: map.numEventsRated ?? 0,
  };
}
