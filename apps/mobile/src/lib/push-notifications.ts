import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { api, throwIfError } from './api';
import type { StoredIdentity } from './identity';

const LAST_TOKEN_KEY = 'le.expoPushToken';

async function readLastToken(): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(LAST_TOKEN_KEY) ?? null;
  return SecureStore.getItemAsync(LAST_TOKEN_KEY);
}

async function writeLastToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(LAST_TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(LAST_TOKEN_KEY, token);
}

/**
 * Request notification permission and register the Expo push token with the API.
 * No-ops on web or when permission is denied. Skips the PUT when the token is unchanged.
 */
export async function registerPushToken(identity: StoredIdentity): Promise<void> {
  if (Platform.OS === 'web') return;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== 'granted') return;

  const projectId =
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
      ?.projectId;
  const token = projectId
    ? (
        await Notifications.getExpoPushTokenAsync({
          projectId,
        })
      ).data
    : (await Notifications.getExpoPushTokenAsync()).data;

  if ((await readLastToken()) === token) return;

  throwIfError(
    await api.PUT('/me/push-token', {
      headers: { Authorization: `Bearer ${identity.sessionToken}` },
      body: {
        deviceCredential: identity.deviceCredential,
        expoPushToken: token,
      },
    }),
  );
  await writeLastToken(token);
}
