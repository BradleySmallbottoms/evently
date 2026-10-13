import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { eventIdFromNotificationData } from '@/lib/notification-target';

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
    const eventId = eventIdFromNotificationData(last.notification.request.content.data);
    if (!eventId) return;
    opened.current = key;
    router.push(`/events/${eventId}`);
  }, [last, router]);

  return null;
}
