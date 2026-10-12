import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { StoredIdentity } from './identity';
import {
  DEFAULT_ONBOARDING_STATE,
  applyAppActivation,
  type OnboardingState,
  type PermissionChoice,
  type PermissionKind,
} from './onboarding-state';
import { registerPushToken } from './push-notifications';

export type { OnboardingState, PermissionChoice, PermissionKind };
export {
  REMINDER_EVERY_ACTIVATIONS,
  applyAppActivation,
  pendingReminderKinds,
} from './onboarding-state';

const STORAGE_KEY = 'le.onboarding.v1';

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  return SecureStore.getItemAsync(STORAGE_KEY);
}

async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(STORAGE_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, value);
}

export async function loadOnboardingState(): Promise<OnboardingState> {
  const raw = await readRaw();
  if (!raw) return { ...DEFAULT_ONBOARDING_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    return {
      ...DEFAULT_ONBOARDING_STATE,
      ...parsed,
      notifications: parsed.notifications ?? null,
      location: parsed.location ?? null,
      lastReminderKind: parsed.lastReminderKind ?? null,
    };
  } catch {
    return { ...DEFAULT_ONBOARDING_STATE };
  }
}

export async function saveOnboardingState(state: OnboardingState): Promise<void> {
  await writeRaw(JSON.stringify(state));
}

export async function markOnboardingComplete(state: OnboardingState): Promise<OnboardingState> {
  const next = { ...state, completed: true };
  await saveOnboardingState(next);
  return next;
}

export async function setPermissionChoice(
  state: OnboardingState,
  kind: PermissionKind,
  choice: PermissionChoice,
): Promise<OnboardingState> {
  const next = { ...state, [kind]: choice };
  await saveOnboardingState(next);
  return next;
}

/**
 * Record an app foreground. Returns a reminder to show, if any.
 */
export async function recordAppActivation(
  state: OnboardingState,
): Promise<{ state: OnboardingState; reminder: PermissionKind | null }> {
  const result = applyAppActivation(state);
  if (result.state !== state) await saveOnboardingState(result.state);
  return result;
}

/** If the OS already granted a skipped permission, mark it granted (no reminder). */
export async function reconcileGrantedPermissions(
  state: OnboardingState,
): Promise<OnboardingState> {
  let next = state;
  let changed = false;

  if (next.notifications === 'skipped') {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      if (status === 'granted') {
        next = { ...next, notifications: 'granted' };
        changed = true;
      }
    } catch {
      /* ignore */
    }
  }

  if (next.location === 'skipped') {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        next = { ...next, location: 'granted' };
        changed = true;
      }
    } catch {
      /* ignore */
    }
  }

  if (changed) await saveOnboardingState(next);
  return next;
}

export async function requestNotificationPermission(
  identity: StoredIdentity,
): Promise<PermissionChoice> {
  if (Platform.OS === 'web') {
    // Web push registration is not wired; treat Activate as acknowledged so we
    // don't keep showing deferred native-style reminders on web.
    return 'granted';
  }
  try {
    await registerPushToken(identity, { request: true });
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted' ? 'granted' : 'denied';
  } catch {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      if (status === 'granted') return 'granted';
    } catch {
      /* permission status unavailable */
    }
    return 'denied';
  }
}

export async function requestLocationPermission(): Promise<PermissionChoice> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    return perm.status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export { STORAGE_KEY as ONBOARDING_STORAGE_KEY };
