import {
  DEFAULT_NOTIFICATION_TIMEZONE,
  DEFAULT_QUIET_HOURS,
  eventNotificationCopy,
  localDayKey,
  shouldPresentOsNotification,
  type QuietHoursPrefs,
} from '@local-events/domain';
import * as Localization from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

const PRESENTED_KEY = 'le.osNotificationsPresented';
const PREFS_KEY = 'le.notificationPresentation';

/** Readable while the device is locked, so a headless push can apply quiet hours and the daily cap. */
const STORE_OPTIONS: SecureStore.SecureStoreOptions | undefined =
  Platform.OS === 'ios' ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } : undefined;

type PresentedBucket = { day: string; count: number };

type CachedPresentationPrefs = {
  locale: string;
  quietHours: QuietHoursPrefs | null;
};

export function defaultQuietHours(): QuietHoursPrefs {
  return {
    enabled: true,
    timezone: DEFAULT_NOTIFICATION_TIMEZONE,
    startMin: DEFAULT_QUIET_HOURS.startMin,
    endMin: DEFAULT_QUIET_HOURS.endMin,
  };
}

function deviceLocale(): string {
  return Localization.getLocales()[0]?.languageCode === 'en' ? 'en' : 'sv';
}

async function readStore(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key, STORE_OPTIONS);
  } catch {
    return null;
  }
}

async function writeStore(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value, STORE_OPTIONS);
  } catch (err) {
    console.warn(
      'notification prefs store failed',
      err instanceof Error ? err.message : 'unknown error',
    );
  }
}

function parseQuietHours(value: unknown): QuietHoursPrefs | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.enabled !== 'boolean') return null;
  if (typeof record.startMin !== 'number' || typeof record.endMin !== 'number') return null;
  if (typeof record.timezone !== 'string' || record.timezone.length === 0) return null;
  return {
    enabled: record.enabled,
    timezone: record.timezone,
    startMin: record.startMin,
    endMin: record.endMin,
  };
}

/** Remember quiet hours and locale for the headless push task. */
export async function cacheNotificationPresentationPrefs(input: {
  locale: string;
  quietHours?: QuietHoursPrefs | null;
}): Promise<void> {
  const existing = await loadCachedPresentationPrefs();
  const next: CachedPresentationPrefs = {
    locale: input.locale === 'en' ? 'en' : 'sv',
    quietHours: input.quietHours ?? existing.quietHours,
  };
  await writeStore(PREFS_KEY, JSON.stringify(next));
}

export async function loadCachedPresentationPrefs(): Promise<CachedPresentationPrefs> {
  const fallback: CachedPresentationPrefs = { locale: deviceLocale(), quietHours: null };
  const raw = await readStore(PREFS_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as { locale?: unknown; quietHours?: unknown };
    return {
      locale: parsed.locale === 'en' ? 'en' : fallback.locale,
      quietHours: parseQuietHours(parsed.quietHours),
    };
  } catch {
    return fallback;
  }
}

async function readBucket(timezone: string): Promise<PresentedBucket> {
  const day = localDayKey(new Date(), timezone);
  const raw = await readStore(PRESENTED_KEY);
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
  await writeStore(PRESENTED_KEY, JSON.stringify(bucket));
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
  const r = reason === 'publisher' || reason === 'event' || reason === 'nearby' ? reason : 'nearby';
  return eventNotificationCopy(locale, eventTitle, r);
}
