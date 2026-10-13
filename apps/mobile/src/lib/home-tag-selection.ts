import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { parseHomeTagIds } from './tag-groups';

export const HOME_TAG_IDS_KEY = 'le.homeTagIds';

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(HOME_TAG_IDS_KEY) ?? null;
  return SecureStore.getItemAsync(HOME_TAG_IDS_KEY);
}

async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(HOME_TAG_IDS_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(HOME_TAG_IDS_KEY, value);
}

export async function loadHomeTagIds(): Promise<string[]> {
  return parseHomeTagIds(await readRaw());
}

let saveQueue = Promise.resolve();

export async function saveHomeTagIds(ids: readonly string[]): Promise<void> {
  const payload = JSON.stringify(ids);
  const run = saveQueue.then(() => writeRaw(payload));
  saveQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
