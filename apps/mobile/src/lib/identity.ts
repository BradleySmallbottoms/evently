import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { ApiError } from '@local-events/api-client';
import { api, throwIfError } from './api';
import { registerPushToken } from './push-notifications';

const KEYS = {
  userId: 'le.userId',
  deviceId: 'le.deviceId',
  deviceCredential: 'le.deviceCredential',
  sessionToken: 'le.sessionToken',
  sessionExpiresAt: 'le.sessionExpiresAt',
} as const;

export type StoredIdentity = {
  userId: string;
  deviceId: string;
  deviceCredential: string;
  sessionToken: string;
  expiresAt: string;
};

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

export async function loadStoredIdentity(): Promise<StoredIdentity | null> {
  const userId = await getItem(KEYS.userId);
  const deviceId = await getItem(KEYS.deviceId);
  const deviceCredential = await getItem(KEYS.deviceCredential);
  const sessionToken = await getItem(KEYS.sessionToken);
  const expiresAt = await getItem(KEYS.sessionExpiresAt);
  if (!userId || !deviceId || !deviceCredential || !sessionToken || !expiresAt) return null;
  return { userId, deviceId, deviceCredential, sessionToken, expiresAt };
}

async function persistIdentity(identity: StoredIdentity): Promise<void> {
  await Promise.all([
    setItem(KEYS.userId, identity.userId),
    setItem(KEYS.deviceId, identity.deviceId),
    setItem(KEYS.deviceCredential, identity.deviceCredential),
    setItem(KEYS.sessionToken, identity.sessionToken),
    setItem(KEYS.sessionExpiresAt, identity.expiresAt),
  ]);
}

async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* missing key */
  }
}

async function clearStoredIdentity(): Promise<void> {
  await Promise.all([...Object.values(KEYS), 'le.expoPushToken'].map((key) => removeItem(key)));
}

function isStaleCredential(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.code === 'invalid_credentials');
}

function platform(): 'ios' | 'android' | 'web' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

async function createAnonymousIdentity(locale: 'sv' | 'en'): Promise<StoredIdentity> {
  const created = throwIfError(
    await api.POST('/identities', {
      body: { platform: platform(), locale },
    }),
  );
  const identity: StoredIdentity = {
    userId: created.userId,
    deviceId: created.deviceId,
    deviceCredential: created.deviceCredential,
    sessionToken: created.sessionToken,
    expiresAt: created.expiresAt,
  };
  await persistIdentity(identity);
  return identity;
}

/** Upload the Expo token when permission is already granted. Never prompts. */
function syncPushToken(identity: StoredIdentity): void {
  void registerPushToken(identity).catch(() => {
    /* permission not granted yet, or push unavailable */
  });
}

/** Ensure the device has an anonymous identity and a fresh-enough session token. */
export async function ensureIdentity(locale: 'sv' | 'en' = 'sv'): Promise<StoredIdentity> {
  const existing = await loadStoredIdentity();
  const identity = existing
    ? await refreshSessionIfNeeded(existing, locale)
    : await createAnonymousIdentity(locale);
  syncPushToken(identity);
  return identity;
}

async function refreshSessionIfNeeded(
  existing: StoredIdentity,
  locale: 'sv' | 'en',
): Promise<StoredIdentity> {
  const expiresSoon = new Date(existing.expiresAt).getTime() - Date.now() < 5 * 60 * 1000;
  if (!expiresSoon) return existing;

  try {
    const session = throwIfError(
      await api.POST('/sessions', {
        body: { deviceCredential: existing.deviceCredential },
      }),
    );
    const refreshed: StoredIdentity = {
      ...existing,
      userId: session.userId,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
    };
    await persistIdentity(refreshed);
    return refreshed;
  } catch (err) {
    if (!isStaleCredential(err)) throw err;
    await clearStoredIdentity();
    return createAnonymousIdentity(locale);
  }
}

/** Force a session exchange (e.g. after device linking remaps this credential to another user). */
export async function refreshIdentitySession(): Promise<StoredIdentity> {
  const existing = await loadStoredIdentity();
  if (!existing) throw new Error('missing_identity');
  const session = throwIfError(
    await api.POST('/sessions', {
      body: { deviceCredential: existing.deviceCredential },
    }),
  );
  const refreshed: StoredIdentity = {
    ...existing,
    userId: session.userId,
    sessionToken: session.sessionToken,
    expiresAt: session.expiresAt,
  };
  await persistIdentity(refreshed);
  syncPushToken(refreshed);
  return refreshed;
}
