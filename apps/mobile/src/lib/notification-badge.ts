import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Highest unread count the user has already opened the inbox for. */
export const NOTIFICATIONS_SEEN_KEY = 'le.notificationsSeenCount';

async function readItem(key: string): Promise<string | null> {
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

export async function loadNotificationsSeenCount(): Promise<number> {
  const raw = await readItem(NOTIFICATIONS_SEEN_KEY);
  const count = Number(raw);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

/** Remember the inbox unread count so the profile-tab dot can clear. */
export async function markNotificationsSeen(unreadCount: number): Promise<void> {
  const next = Math.max(0, unreadCount);
  const current = await loadNotificationsSeenCount();
  if (next < current) return;
  await writeItem(NOTIFICATIONS_SEEN_KEY, String(next));
}
