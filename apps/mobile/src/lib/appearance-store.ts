import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { APPEARANCE_STORAGE_KEY, parseAppearance, type AppearancePreference } from './appearance';

export async function loadAppearance(): Promise<AppearancePreference> {
  try {
    const stored =
      Platform.OS === 'web'
        ? globalThis.localStorage?.getItem(APPEARANCE_STORAGE_KEY)
        : await SecureStore.getItemAsync(APPEARANCE_STORAGE_KEY);
    return parseAppearance(stored);
  } catch {
    return 'system';
  }
}

export async function saveAppearance(preference: AppearancePreference): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(APPEARANCE_STORAGE_KEY, preference);
    return;
  }
  await SecureStore.setItemAsync(APPEARANCE_STORAGE_KEY, preference);
}
