import type { ExpoPushMessage } from './expo-push';

/**
 * Event and broadcast delivery. A visible alert is what iOS and Android show
 * as a banner. Quiet hours send the badge and the inbox data only.
 */
export function inboxExpoMessage(input: {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  badge: number;
  alert: boolean;
}): ExpoPushMessage {
  if (!input.alert) {
    return {
      to: input.to,
      data: input.data,
      badge: input.badge,
      _contentAvailable: true,
      priority: 'normal',
    };
  }
  return {
    to: input.to,
    title: input.title,
    body: input.body,
    sound: 'default',
    priority: 'high',
    badge: input.badge,
    channelId: 'inbox',
    data: input.data,
  };
}
