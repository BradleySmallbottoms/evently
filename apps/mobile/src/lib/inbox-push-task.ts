import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { badgeUpdateFromTaskPayload } from './app-icon-badge';
import { inboxPushFieldsFromTaskPayload } from './inbox-push-payload';
import { applyReceivedAppIconBadge, presentSilentInboxNotification } from './push-notifications';

/** Headless handler for silent inbox pushes (background and terminated). */
export const INBOX_PUSH_TASK = 'inbox-silent-push';

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  INBOX_PUSH_TASK,
  async ({ data, error }) => {
    if (error) return Notifications.BackgroundNotificationTaskResult.Failed;
    try {
      const badge = badgeUpdateFromTaskPayload(data);
      if (badge) {
        await applyReceivedAppIconBadge({ count: badge.count, key: badge.key });
      }
      const fields = inboxPushFieldsFromTaskPayload(data);
      if (!fields) return Notifications.BackgroundNotificationTaskResult.NoData;
      const presented = await presentSilentInboxNotification(fields, { badge: badge?.count });
      return presented
        ? Notifications.BackgroundNotificationTaskResult.NewData
        : Notifications.BackgroundNotificationTaskResult.NoData;
    } catch (err) {
      console.warn('inbox push task failed', err instanceof Error ? err.message : 'unknown error');
      return Notifications.BackgroundNotificationTaskResult.Failed;
    }
  },
);

if (Platform.OS !== 'web') {
  void Notifications.registerTaskAsync(INBOX_PUSH_TASK).catch((err) => {
    console.warn(
      'inbox push task registration failed',
      err instanceof Error ? err.message : 'unknown error',
    );
  });
}
