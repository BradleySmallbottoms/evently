import { DEFAULT_NOTIFICATION_TIMEZONE, type QuietHoursPrefs } from '@local-events/domain';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

import {
  badgeApplyKey,
  badgeCountFromNotification,
  isLocalInboxPush,
  resolveAppIconBadge,
} from './app-icon-badge';
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
const appliedBadgeKeys = new Set<string>();
/** Bumped when the icon badge is cleared so a late push cannot restore it. */
let badgeEpoch = 0;
/** Badge writes run one at a time, in the order they were requested. */
let badgeWrite = Promise.resolve();

function enqueueBadgeWrite(work: () => Promise<void>): Promise<void> {
  const run = badgeWrite.then(work, work);
  badgeWrite = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

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
    const localInbox = data.kind === 'local_inbox';
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

    const badge = notification.request.content.badge;
    return {
      shouldShowBanner: show,
      shouldShowList: show,
      shouldPlaySound: show,
      // The silent push already set the count. The local banner must not write it again
      // after the app has opened and cleared the icon.
      shouldSetBadge:
        !localInbox && typeof badge === 'number' && Number.isFinite(badge) && badge >= 0,
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

export type AppIconBadgeInput = {
  count: number | null;
  key?: string | null;
  /** Foreground listener sets the icon even while the app is open. The headless task does not. */
  allowWhileActive?: boolean;
};

/**
 * Post a local banner for a silent inbox push when outside quiet hours and under
 * the daily cap, including while the app is in the foreground.
 */
export async function presentSilentInboxNotification(
  data: InboxPushData,
  overrides?: { quietHours?: QuietHoursPrefs | null; locale?: string; badge?: number | null },
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
    const badge = finiteContentBadge(overrides?.badge);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: copy.title,
        body: copy.body,
        sound: true,
        ...(badge != null ? { badge } : {}),
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

function finiteContentBadge(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

async function writeAppIconBadge(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(count);
}

/** Clears the app icon badge. No-op on web and when the OS rejects the update. */
export async function clearAppIconBadge(): Promise<void> {
  if (Platform.OS === 'web') return;
  badgeEpoch += 1;
  const epoch = badgeEpoch;
  try {
    await enqueueBadgeWrite(async () => {
      if (epoch !== badgeEpoch) return;
      await writeAppIconBadge(0);
    });
  } catch (err) {
    console.warn(
      'clear notification badge failed',
      err instanceof Error ? err.message : 'unknown error',
    );
  }
}

/**
 * Sets the icon badge from a received push. An absolute count replaces the icon
 * number. A push with no count adds one. Opening the app clears it, and a push
 * that finishes after that clear does not put the number back.
 */
export async function applyReceivedAppIconBadge(input: AppIconBadgeInput): Promise<void> {
  if (Platform.OS === 'web') return;
  const epoch = badgeEpoch;
  const allowWhileActive = input.allowWhileActive === true;
  if (AppState.currentState === 'active' && !allowWhileActive) return;
  const key = input.key ?? null;
  if (key) {
    if (appliedBadgeKeys.has(key)) return;
    if (appliedBadgeKeys.size > 200) appliedBadgeKeys.clear();
    appliedBadgeKeys.add(key);
  }

  try {
    await enqueueBadgeWrite(async () => {
      if (epoch !== badgeEpoch) return;
      if (AppState.currentState === 'active' && !allowWhileActive) return;
      const current = input.count == null ? await Notifications.getBadgeCountAsync() : 0;
      if (epoch !== badgeEpoch) return;
      const next = resolveAppIconBadge({
        appIsActive: AppState.currentState === 'active',
        allowWhileActive,
        current,
        incoming: input.count,
        duplicate: false,
      });
      if (next == null) return;
      await writeAppIconBadge(next);
      if (epoch !== badgeEpoch) await writeAppIconBadge(0);
    });
  } catch (err) {
    if (key) appliedBadgeKeys.delete(key);
    console.warn(
      'set notification badge failed',
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
      const badge = isLocalInboxPush(data)
        ? null
        : badgeCountFromNotification({
            contentBadge: notification.request.content.badge,
            data,
          });
      if (!isLocalInboxPush(data)) {
        await applyReceivedAppIconBadge({
          count: badge,
          key: badgeApplyKey(data, notification.request.identifier),
          allowWhileActive: true,
        });
      }
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
      await presentSilentInboxNotification(data, { quietHours, locale, badge });
    })();
  });

  return () => sub.remove();
}
