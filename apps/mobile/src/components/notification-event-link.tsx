import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform } from 'react-native';

import {
  eventIdFromNotificationData,
  tipTargetFromNotificationData,
} from '@/lib/notification-target';
import { tipNotificationScreen } from '@/lib/open-inbox-item';

/** Opens the event when the user taps a reminder or an event push. No-op on web. */
export function NotificationEventLink() {
  if (Platform.OS === 'web') return null;
  return <NativeNotificationEventLink />;
}

function NativeNotificationEventLink() {
  const router = useRouter();
  const { i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en' : 'sv';
  const last = Notifications.useLastNotificationResponse();
  const opened = useRef<string | null>(null);
  const received = useRef(new Set<string>());

  const openTip = useCallback(
    (tip: { tipId: string; screen: 'published' | 'status' }) => {
      void tipNotificationScreen(locale, tip).then((screen) => {
        if (screen === 'published') router.push(`/tips/published/${tip.tipId}`);
        else router.push(`/tips/${tip.tipId}`);
      });
    },
    [locale, router],
  );

  useEffect(() => {
    if (!last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const key = last.notification.request.identifier;
    if (opened.current === key) return;
    const data = last.notification.request.content.data;
    const tip = tipTargetFromNotificationData(data);
    if (tip) {
      opened.current = key;
      openTip(tip);
      return;
    }
    const eventId = eventIdFromNotificationData(data);
    if (!eventId) return;
    opened.current = key;
    router.push(`/events/${eventId}`);
  }, [last, openTip, router]);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      if (AppState.currentState !== 'active') return;
      const key = notification.request.identifier;
      if (received.current.has(key)) return;
      const tip = tipTargetFromNotificationData(notification.request.content.data);
      if (!tip) return;
      received.current.add(key);
      openTip(tip);
    });
    return () => sub.remove();
  }, [openTip]);

  return null;
}
