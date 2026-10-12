import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  reminderIdentifier,
  selectedReminderSlots,
  type ReminderSlot,
} from './reminder-times';

const ANDROID_CHANNEL = 'reminders';

export type ReminderBodies = Record<ReminderSlot, string>;

export type ScheduleReminderResult = 'scheduled' | 'web' | 'permission' | 'none';

async function ensureReminderChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: 'Påminnelser',
      importance: Notifications.AndroidImportance.HIGH,
    });
  } catch (err) {
    console.warn(
      'reminder channel setup failed',
      err instanceof Error ? err.message : 'unknown error',
    );
  }
}

export async function eventReminderSlots(eventId: string): Promise<ReminderSlot[]> {
  if (Platform.OS === 'web') return [];
  const prefix = `le.reminder.${eventId}.`;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const slots: ReminderSlot[] = [];
  for (const item of scheduled) {
    if (!item.identifier.startsWith(prefix)) continue;
    const slot = item.identifier.slice(prefix.length);
    if (slot === 'day' || slot === 'hour' || slot === 'start') slots.push(slot);
  }
  return slots;
}

export async function eventHasReminder(eventId: string): Promise<boolean> {
  const slots = await eventReminderSlots(eventId);
  return slots.length > 0;
}

export async function cancelEventReminder(eventId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await Promise.all(
    (['day', 'hour', 'start'] as const).map(async (slot) => {
      try {
        await Notifications.cancelScheduledNotificationAsync(reminderIdentifier(eventId, slot));
      } catch {
        // Already gone.
      }
    }),
  );
}

/** Local OS notifications for the slots the user picked. */
export async function scheduleEventReminders(input: {
  eventId: string;
  title: string;
  startsAt: string;
  bodies: ReminderBodies;
  slots: readonly ReminderSlot[];
}): Promise<ScheduleReminderResult> {
  if (Platform.OS === 'web') return 'web';

  const slots = selectedReminderSlots(new Date(input.startsAt), new Date(), input.slots);
  if (slots.length === 0) return 'none';

  await ensureReminderChannel();
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }
  if (status !== 'granted') return 'permission';

  await cancelEventReminder(input.eventId);
  await Promise.all(
    slots.map((slot) =>
      Notifications.scheduleNotificationAsync({
        identifier: reminderIdentifier(input.eventId, slot.slot),
        content: {
          title: input.title,
          body: input.bodies[slot.slot],
          sound: true,
          data: { kind: 'reminder', eventId: input.eventId, slot: slot.slot },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: slot.at,
          ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : {}),
        },
      }),
    ),
  );
  return 'scheduled';
}
