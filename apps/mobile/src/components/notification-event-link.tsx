import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { eventIdFromNotificationData, tipIdFromNotificationData } from '@/lib/notification-target';

/** Opens the event when the user taps a reminder or an event push. No-op on web. */
export function NotificationEventLink() {
  if (Platform.OS === 'web') return null;
  return <NativeNotificationEventLink />;
}

function NativeNotificationEventLink() {
  const router = useRouter();
  const last = Notifications.useLastNotificationResponse();
  const opened = useRef<string | null>(null);

  useEffect(() => {
    if (!last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const key = last.notification.request.identifier;
    if (opened.current === key) return;
    const data = last.notification.request.content.data;
    const tipId = tipIdFromNotificationData(data);
    if (tipId) {
      opened.current = key;
      router.push(`/tips/${tipId}`);
      return;
    }
    const eventId = eventIdFromNotificationData(data);
    if (!eventId) return;
    opened.current = key;
    router.push(`/events/${eventId}`);
  }, [last, router]);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      if (AppState.currentState !== 'active') return;
      const tipId = tipIdFromNotificationData(notification.request.content.data);
      if (!tipId) return;
      router.push(`/tips/${tipId}`);
    });
    return () => sub.remove();
  }, [router]);

  return null;
}
