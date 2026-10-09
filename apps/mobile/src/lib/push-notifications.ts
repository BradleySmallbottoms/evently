import {
  DEFAULT_NOTIFICATION_TIMEZONE,
  DEFAULT_QUIET_HOURS,
  type QuietHoursPrefs,
} from '@local-events/domain';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { api, throwIfError } from './api';
import type { StoredIdentity } from './identity';
import {
  decideOsNotificationPresentation,
  localNotificationCopy,
  recordPresentedOsNotification,
} from './notification-presentation';

const LAST_TOKEN_KEY = 'le.expoPushToken';
const ANDROID_CHANNEL = 'events';

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

/** Remote pushes are silent; never show the Expo payload as an OS alert. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    name: 'Events',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Request notification permission and register the Expo push token with the API.
 * No-ops on web or when permission is denied. Skips the PUT when the token is unchanged.
 */
export async function registerPushToken(identity: StoredIdentity): Promise<void> {
  if (Platform.OS === 'web') return;

  await ensureAndroidNotificationChannel();

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

export type InboxPushData = {
  kind?: string;
  notificationId?: string;
  eventId?: string;
  reason?: string;
  eventTitle?: string;
};

export type SilentPushHandlers = {
  getQuietHours: () => QuietHoursPrefs | null | undefined;
  getLocale: () => string;
  onInboxPing: (data: InboxPushData) => void;
};

/**
 * Listen for silent inbox pushes. Updates callers (badge/list) and may post a
 * local OS notification when under daily cap and outside quiet hours.
 */
export function subscribeSilentPushHandlers(handlers: SilentPushHandlers): () => void {
  if (Platform.OS === 'web') return () => {};

  const sub = Notifications.addNotificationReceivedListener((notification) => {
    void (async () => {
      const data = (notification.request.content.data ?? {}) as InboxPushData;
      if (data.kind !== 'inbox') {
        handlers.onInboxPing(data);
        return;
      }
      handlers.onInboxPing(data);

      const quiet =
        handlers.getQuietHours() ??
        ({
          enabled: true,
          timezone: DEFAULT_NOTIFICATION_TIMEZONE,
          startMin: DEFAULT_QUIET_HOURS.startMin,
          endMin: DEFAULT_QUIET_HOURS.endMin,
        } satisfies QuietHoursPrefs);

      const present = await decideOsNotificationPresentation({ quietHours: quiet });
      if (!present) return;

      const title = data.eventTitle?.trim() || 'Event';
      const copy = localNotificationCopy(handlers.getLocale(), title, data.reason ?? 'nearby');
      await Notifications.scheduleNotificationAsync({
        content: {
          title: copy.title,
          body: copy.body,
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
    })();
  });

  return () => sub.remove();
}
