import * as SecureStore from 'expo-secure-store';

import { api, throwIfError } from './api';
import type { StoredIdentity } from './identity';

export type CachedContentItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  visibility: string;
  url: string | null;
  urlExpiresAt: string | null;
};

function cacheKey(eventId: string) {
  return `event-content:${eventId}`;
}

export async function fetchEventContent(identity: StoredIdentity | null, eventId: string) {
  const result = throwIfError(
    await api.GET('/events/{eventId}/content', {
      params: { path: { eventId } },
      ...(identity
        ? { headers: { Authorization: `Bearer ${identity.sessionToken}` } }
        : {}),
    }),
  );
  if (result.checkedIn && result.items.length > 0) {
    const cacheable: CachedContentItem[] = result.items.map((i) => ({
      id: i.id,
      kind: i.kind,
      title: i.title,
      body: i.body,
      visibility: i.visibility,
      url: i.url,
      urlExpiresAt: i.urlExpiresAt,
    }));
    await SecureStore.setItemAsync(cacheKey(eventId), JSON.stringify(cacheable));
  }
  return result;
}

/** Offline fallback after a prior checked-in fetch. */
export async function readCachedEventContent(
  eventId: string,
): Promise<CachedContentItem[] | null> {
  const raw = await SecureStore.getItemAsync(cacheKey(eventId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedContentItem[];
  } catch {
    return null;
  }
}
