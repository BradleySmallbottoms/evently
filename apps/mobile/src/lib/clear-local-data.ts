import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** All known persistent keys used by the mobile app (identity, prefs helpers, caches). */
const KNOWN_KEYS = [
  'le.userId',
  'le.deviceId',
  'le.deviceCredential',
  'le.sessionToken',
  'le.sessionExpiresAt',
  'le.expoPushToken',
  'le.osNotificationsPresented',
  'le.region.lastPromptAt',
  'le.region.declines',
  'le.region.fgStartedAt',
  'le.region.screensOpened',
  'le.onboarding.v1',
  'le.notificationsSeenCount',
] as const;

async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Missing key is fine.
  }
}

/**
 * Wipe device identity, session, and other local app state so the next launch
 * creates a fresh anonymous identity (dev/reset helper).
 */
export async function clearLocalAppData(): Promise<void> {
  await Promise.all(KNOWN_KEYS.map((key) => removeItem(key)));

  if (Platform.OS === 'web' && globalThis.localStorage) {
    const toRemove: string[] = [];
    for (let i = 0; i < globalThis.localStorage.length; i++) {
      const key = globalThis.localStorage.key(i);
      if (!key) continue;
      if (key.startsWith('le.') || key.startsWith('event-content:')) toRemove.push(key);
    }
    for (const key of toRemove) globalThis.localStorage.removeItem(key);
  }
}
