import { DEFAULT_NOTIFICATION_TIMEZONE, type QuietHoursPrefs } from '@local-events/domain';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

import { api, throwIfError } from './api';
import type { StoredIdentity } from './identity';
import {
  cacheNotificationPresentationPrefs,
  decideOsNotificationPresentation,
  defaultQuietHours,
  loadCachedPresentationPrefs,
  localNotificationCopy,
  recordPresentedOsNotification,
} from './notification-presentation';

const LAST_TOKEN_KEY = 'le.expoPushToken';
const ANDROID_CHANNEL = 'inbox';
const presentedInboxIds = new Set<string>();

function pushDebug(step: string, detail: Record<string, unknown> = {}): void {
  console.log('PUSH received', JSON.stringify({ pushDebug: { step, ...detail } }));
}

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
 * Reminders and notifications that already have alert text are shown, including
 * while the app is open. Silent inbox pushes have no title; a local notification
 * is posted instead (foreground listener or the headless task).
 */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data ?? {};
    const tipWhileOpen = data.kind === 'tip_scan' && AppState.currentState === 'active';
    const show =
      !tipWhileOpen &&
      (data.kind === 'reminder' ||
        data.kind === 'local_inbox' ||
        Boolean(notification.request.content.title));
    pushDebug('received', {
      kind: typeof data.kind === 'string' ? data.kind : null,
      title:
        notification.request.content.title ?? (typeof data.title === 'string' ? data.title : null),
      body: notification.request.content.body ?? (typeof data.body === 'string' ? data.body : null),
      identifier: notification.request.identifier,
      showBanner: show,
    });

    return {
      shouldShowBanner: show,
      shouldShowList: show,
      shouldPlaySound: show,
      shouldSetBadge: true,
    };
  },
});

export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: 'Events',
      importance: Notifications.AndroidImportance.HIGH,
    });
  } catch (err) {
    // Expo Go does not ship the Android notification channel module. Permission
    // can still be requested; local alerts use the default channel.
    console.warn(
      'notification channel setup failed',
      err instanceof Error ? err.message : 'unknown error',
    );
  }
}

/**
 * Register the Expo push token with the API when notification permission is granted.
 * Pass `{ request: true }` only from onboarding Activate and reminders; every other
 * caller leaves the default and returns without prompting.
 * No-ops on web, when permission is denied, or when the stored token is unchanged.
 */
export async function registerPushToken(
  identity: StoredIdentity,
  options: { request?: boolean } = {},
): Promise<void> {
  if (Platform.OS === 'web') return;

  await ensureAndroidNotificationChannel();

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    if (!options.request) return;
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== 'granted') return;

  // Remote push tokens are unavailable in Android Expo Go (the call throws) and
  // without an EAS project id. The OS permission above is still the Activate result.
  if (isRunningInExpoGo() && Platform.OS === 'android') return;

  const projectId =
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return;

  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (err) {
    console.warn(
      'push token registration failed',
      err instanceof Error ? err.message : 'unknown error',
    );
    return;
  }

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

export type InboxPushData = {
  kind?: string;
  notificationId?: string;
  eventId?: string;
  reason?: string;
  eventTitle?: string;
  title?: string;
  body?: string;
  moreCount?: number;
};

export type SilentPushHandlers = {
  getQuietHours: () => QuietHoursPrefs | null | undefined;
  getLocale: () => string;
  onInboxPing: (data: InboxPushData) => void;
};

/**
 * Post a local banner for a silent inbox push when outside quiet hours and under
 * the daily cap, including while the app is in the foreground.
 */
export async function presentSilentInboxNotification(
  data: InboxPushData,
  overrides?: { quietHours?: QuietHoursPrefs | null; locale?: string },
): Promise<boolean> {
  if (data.kind !== 'inbox') return false;
  const id = data.notificationId?.trim();
  if (id) {
    if (presentedInboxIds.has(id)) return false;
    presentedInboxIds.add(id);
  }

  try {
    const cached =
      overrides?.quietHours && overrides.locale ? null : await loadCachedPresentationPrefs();
    const quiet = overrides?.quietHours ?? cached?.quietHours ?? defaultQuietHours();
    const locale = overrides?.locale ?? cached?.locale ?? 'sv';
    const present = await decideOsNotificationPresentation({ quietHours: quiet });
    pushDebug('present', { present, notificationId: id ?? null });
    if (!present) {
      if (id) presentedInboxIds.delete(id);
      return false;
    }

    await ensureAndroidNotificationChannel();
    const title =
      (typeof data.title === 'string' && data.title.trim()) || data.eventTitle?.trim() || 'Event';
    const bodyFromPush = typeof data.body === 'string' ? data.body.trim() : '';
    const copy = bodyFromPush
      ? { title, body: bodyFromPush }
      : localNotificationCopy(locale, title, data.reason ?? 'nearby');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: copy.title,
        body: copy.body,
        sound: true,
        data: {
          kind: 'local_inbox',
          notificationId: data.notificationId ?? '',
          eventId: data.eventId ?? '',
          reason: data.reason ?? 'nearby',
        },
        ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : {}),
      },
      trigger: null,
    });
    await recordPresentedOsNotification(quiet.timezone || DEFAULT_NOTIFICATION_TIMEZONE);
    return true;
  } catch (err) {
    if (id) presentedInboxIds.delete(id);
    console.warn(
      'local inbox notification failed',
      err instanceof Error ? err.message : 'unknown error',
    );
    return false;
  }
}

/** Clears the app icon badge. No-op on web and when the OS rejects the update. */
export async function clearAppIconBadge(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch (err) {
    console.warn(
      'clear notification badge failed',
      err instanceof Error ? err.message : 'unknown error',
    );
  }
}

/**
 * Foreground listener for silent inbox pushes. Refreshes callers and may post
 * a local banner. Background and terminated delivery is handled by the headless task.
 */
export function subscribeSilentPushHandlers(handlers: SilentPushHandlers): () => void {
  if (Platform.OS === 'web') return () => {};

  const sub = Notifications.addNotificationReceivedListener((notification) => {
    void (async () => {
      const data = (notification.request.content.data ?? {}) as InboxPushData;
      pushDebug('listener', {
        kind: data.kind ?? null,
        title: data.title ?? data.eventTitle ?? null,
        reason: data.reason ?? null,
        notificationId: data.notificationId ?? null,
      });
      if (data.kind !== 'inbox') {
        handlers.onInboxPing(data);
        return;
      }
      handlers.onInboxPing(data);

      if (notification.request.content.title) {
        pushDebug('present', { present: false, reason: 'remote_alert' });
        return;
      }

      const quietHours = handlers.getQuietHours();
      const locale = handlers.getLocale();
      await cacheNotificationPresentationPrefs({ locale, quietHours });
      await presentSilentInboxNotification(data, { quietHours, locale });
    })();
  });

  return () => sub.remove();
}
