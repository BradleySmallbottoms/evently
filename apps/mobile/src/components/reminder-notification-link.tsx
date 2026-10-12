import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/** Opens the event when the user taps a scheduled reminder. No-op on web. */
export function ReminderNotificationLink() {
  if (Platform.OS === 'web') return null;
  return <NativeReminderLink />;
}

function NativeReminderLink() {
  const router = useRouter();
  const last = Notifications.useLastNotificationResponse();
  const opened = useRef<string | null>(null);

  useEffect(() => {
    if (!last) return;
    const key = last.notification.request.identifier;
    if (opened.current === key) return;
    const data = last.notification.request.content.data as {
      kind?: unknown;
      eventId?: unknown;
    };
    if (data.kind !== 'reminder' || typeof data.eventId !== 'string' || data.eventId.length === 0) {
      return;
    }
    opened.current = key;
    router.push(`/events/${data.eventId}`);
  }, [last, router]);

  return null;
}
