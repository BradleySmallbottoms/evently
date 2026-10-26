import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  PARTICIPATE_BAR_HINT_SEEN_KEY,
  PARTICIPATE_BAR_HINT_SEEN_VALUE,
  isParticipateBarHintSeen,
} from './participate-bar-hint';

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

export async function loadParticipateBarHintSeen(): Promise<boolean> {
  return isParticipateBarHintSeen(await readItem(PARTICIPATE_BAR_HINT_SEEN_KEY));
}

export async function saveParticipateBarHintSeen(): Promise<void> {
  await writeItem(PARTICIPATE_BAR_HINT_SEEN_KEY, PARTICIPATE_BAR_HINT_SEEN_VALUE);
}
