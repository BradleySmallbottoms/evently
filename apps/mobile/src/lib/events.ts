import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { api, throwIfError } from './api';

export const FALLBACK_CENTER = {
  lat: 61.3037,
  lng: 17.0592,
  radiusM: 50_000,
} as const;

/** Web geolocation/permission prompts often hang until the tab is focused again. */
export const LOCATION_TIMEOUT_MS = Platform.OS === 'web' ? 2_000 : 8_000;

export type EventQueryPoint = {
  lat: number;
  lng: number;
  radiusM: number;
};

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('location_timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** One balanced foreground fix. Throws on timeout or provider failure. Does not prompt. */
export async function readBalancedForegroundPosition(): Promise<{ lat: number; lng: number }> {
  const position = await withTimeout(
    Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      mayShowUserSettingsDialog: false,
    }),
    LOCATION_TIMEOUT_MS,
  );
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}

export async function resolveEventQueryPoint(): Promise<EventQueryPoint> {
  try {
    // Do not prompt here — onboarding / reminders / check-in own the permission request.
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      return { ...FALLBACK_CENTER };
    }
    const position = await readBalancedForegroundPosition();
    return { ...position, radiusM: FALLBACK_CENTER.radiusM };
  } catch {
    return { ...FALLBACK_CENTER };
  }
}

export async function listTags(options?: { upcoming?: boolean }) {
  const upcoming = options?.upcoming !== false;
  return throwIfError(
    await api.GET('/tags', {
      params: {
        query: upcoming ? { upcoming: 'true' } : {},
      },
    }),
  );
}

/** Tag labels in the event's tag order. Unknown ids are skipped. */
export function namesForTagIds(
  tagIds: string[],
  tags: { id: string; name: string }[] | undefined,
): string[] {
  if (!tags?.length || tagIds.length === 0) return [];
  const byId = new Map(tags.map((tag) => [tag.id, tag.name]));
  return tagIds.flatMap((id) => {
    const name = byId.get(id);
    return name ? [name] : [];
  });
}

export const PUBLIC_EVENT_PAGE_SIZE = 20;

export async function listPublicEvents(
  point: EventQueryPoint,
  filter?: {
    q?: string;
    tagId?: string;
    tagIds?: string[];
    from?: string;
    to?: string;
    price?: 'free' | 'paid';
    sort?: 'soonest' | 'distance' | 'popular';
    offset?: number;
    limit?: number;
  },
) {
  return throwIfError(
    await api.GET('/events', {
      params: {
        query: {
          lat: point.lat,
          lng: point.lng,
          radiusM: point.radiusM,
          ...(filter?.q ? { q: filter.q } : {}),
          ...(filter?.tagId ? { tagId: filter.tagId } : {}),
          ...(filter?.tagIds?.length ? { tagIds: filter.tagIds.join(',') } : {}),
          ...(filter?.from ? { from: filter.from } : {}),
          ...(filter?.to ? { to: filter.to } : {}),
          ...(filter?.price ? { price: filter.price } : {}),
          ...(filter?.sort ? { sort: filter.sort } : {}),
          ...(filter?.offset ? { offset: filter.offset } : {}),
          ...(filter?.limit ? { limit: filter.limit } : {}),
        },
      },
    }),
  );
}

export async function getPublicEvent(id: string) {
  return throwIfError(
    await api.GET('/events/{id}', {
      params: { path: { id } },
    }),
  );
}
