import {
  DEFAULT_NOTIFICATION_TIMEZONE,
  eventNotificationCopy,
  localDayKey,
  shouldPresentOsNotification,
  type QuietHoursPrefs,
} from '@local-events/domain';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

const PRESENTED_KEY = 'le.osNotificationsPresented';

type PresentedBucket = { day: string; count: number };

async function readBucket(timezone: string): Promise<PresentedBucket> {
  const day = localDayKey(new Date(), timezone);
  let raw: string | null = null;
  if (Platform.OS === 'web') {
    raw = globalThis.localStorage?.getItem(PRESENTED_KEY) ?? null;
  } else {
    raw = await SecureStore.getItemAsync(PRESENTED_KEY);
  }
  if (!raw) return { day, count: 0 };
  try {
    const parsed = JSON.parse(raw) as PresentedBucket;
    if (parsed.day !== day) return { day, count: 0 };
    return { day, count: Number(parsed.count) || 0 };
  } catch {
    return { day, count: 0 };
  }
}

async function writeBucket(bucket: PresentedBucket): Promise<void> {
  const raw = JSON.stringify(bucket);
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(PRESENTED_KEY, raw);
    return;
  }
  await SecureStore.setItemAsync(PRESENTED_KEY, raw);
}

export async function getPresentedOsNotificationCount(timezone: string): Promise<number> {
  return (await readBucket(timezone)).count;
}

export async function recordPresentedOsNotification(timezone: string): Promise<void> {
  const bucket = await readBucket(timezone);
  await writeBucket({ day: bucket.day, count: bucket.count + 1 });
}

export async function decideOsNotificationPresentation(input: {
  quietHours: QuietHoursPrefs;
  now?: Date;
}): Promise<boolean> {
  const timezone = input.quietHours.timezone || DEFAULT_NOTIFICATION_TIMEZONE;
  const presentedToday = await getPresentedOsNotificationCount(timezone);
  return shouldPresentOsNotification({
    now: input.now ?? new Date(),
    quietHours: input.quietHours,
    presentedToday,
    appInForeground: AppState.currentState === 'active',
  });
}

export function localNotificationCopy(
  locale: string,
  eventTitle: string,
  reason: string,
): { title: string; body: string } {
  const r =
    reason === 'publisher' || reason === 'event' || reason === 'nearby' ? reason : 'nearby';
  return eventNotificationCopy(locale, eventTitle, r);
}
