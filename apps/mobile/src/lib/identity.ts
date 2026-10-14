import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api, throwIfError } from './api';
import { clearLocalAppData } from './clear-local-data';
import { isRejectedIdentity } from './identity-check';
import { registerPushToken } from './push-notifications';

let identityWrite: Promise<void> = Promise.resolve();
/** Bumped when the device is wiped so an in-flight rejection cannot reopen the alert. */
let identityEpoch = 0;

function withIdentityLock<T>(work: () => Promise<T>): Promise<T> {
  const run = identityWrite.then(work, work);
  identityWrite = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

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

async function writeIdentity(identity: StoredIdentity): Promise<void> {
  await Promise.all([
    setItem(KEYS.userId, identity.userId),
    setItem(KEYS.deviceId, identity.deviceId),
    setItem(KEYS.deviceCredential, identity.deviceCredential),
    setItem(KEYS.sessionToken, identity.sessionToken),
    setItem(KEYS.sessionExpiresAt, identity.expiresAt),
  ]);
}

async function persistIdentity(identity: StoredIdentity): Promise<void> {
  await withIdentityLock(() => writeIdentity(identity));
}

/** Drop every local store after the user confirms the identity is gone. */
export async function discardStoredIdentity(): Promise<void> {
  identityEpoch += 1;
  await withIdentityLock(() => clearLocalAppData());
}

export type IdentityCheck = 'valid' | 'invalid' | 'missing' | 'unavailable';

/** Fired when a session exchange proves the stored credential is gone or banned. */
let onIdentityRejected: (() => void) | null = null;

export function setIdentityRejectedHandler(handler: (() => void) | null): void {
  onIdentityRejected = handler;
}

export function currentIdentityEpoch(): number {
  return identityEpoch;
}

function notifyIdentityRejected(epoch: number): void {
  if (epoch !== identityEpoch) return;
  onIdentityRejected?.();
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

/** One create shared by concurrent callers (onboarding mounts two at once). */
let pendingIdentity: Promise<StoredIdentity> | null = null;

/** Ensure the device has an anonymous identity and a fresh-enough session token. */
export async function ensureIdentity(locale: 'sv' | 'en' = 'sv'): Promise<StoredIdentity> {
  const existing = await loadStoredIdentity();
  if (existing) {
    const identity = await refreshSessionIfNeeded(existing);
    syncPushToken(identity);
    return identity;
  }
  if (!pendingIdentity) {
    pendingIdentity = createAnonymousIdentity(locale).finally(() => {
      pendingIdentity = null;
    });
  }
  const identity = await pendingIdentity;
  syncPushToken(identity);
  return identity;
}

async function exchangeSession(existing: StoredIdentity): Promise<StoredIdentity> {
  const epoch = identityEpoch;
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
    await withIdentityLock(async () => {
      if (epoch !== identityEpoch) throw new Error('identity_check_stale');
      await writeIdentity(refreshed);
    });
    return refreshed;
  } catch (err) {
    if (isRejectedIdentity(err)) notifyIdentityRejected(epoch);
    throw err;
  }
}

/**
 * Prove the stored device credential still belongs to an active user.
 * Network failures stay `unavailable` so a blip does not wipe the device.
 */
export async function verifyStoredIdentity(): Promise<IdentityCheck> {
  const existing = await loadStoredIdentity();
  if (!existing) return 'missing';
  try {
    await exchangeSession(existing);
    return 'valid';
  } catch (err) {
    if (!isRejectedIdentity(err)) return 'unavailable';
    return 'invalid';
  }
}

async function refreshSessionIfNeeded(existing: StoredIdentity): Promise<StoredIdentity> {
  const expiresSoon = new Date(existing.expiresAt).getTime() - Date.now() < 5 * 60 * 1000;
  if (!expiresSoon) return existing;

  return exchangeSession(existing);
}

/** Force a session exchange (e.g. after device linking remaps this credential to another user). */
export async function refreshIdentitySession(): Promise<StoredIdentity> {
  const existing = await loadStoredIdentity();
  if (!existing) throw new Error('missing_identity');
  const refreshed = await exchangeSession(existing);
  syncPushToken(refreshed);
  return refreshed;
}
