import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** When the user last opened the notification list. */
export const NOTIFICATIONS_SEEN_AT_KEY = 'le.notificationsSeenAt';

async function readItem(key: string): Promise<string | null> {
  // A UI timestamp, not a credential. On web it lives in localStorage.
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function writeItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function loadNotificationsSeenAt(): Promise<string | null> {
  const raw = await readItem(NOTIFICATIONS_SEEN_AT_KEY);
  if (!raw || Number.isNaN(Date.parse(raw))) return null;
  return raw;
}

/** The list is open, so notifications already in it are not new. */
export async function markNotificationsSeenNow(at: Date = new Date()): Promise<void> {
  await writeItem(NOTIFICATIONS_SEEN_AT_KEY, at.toISOString());
}
