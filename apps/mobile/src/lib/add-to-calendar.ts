import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { CalendarDraft } from './calendar-draft';

type CalendarModule = typeof import('expo-calendar');

/**
 * Importing expo-calendar asks for CalendarNext immediately. Probe first so a
 * development build from before that module was added shows the alert instead
 * of a redbox.
 */
function calendarModuleInstalled(): boolean {
  return requireOptionalNativeModule('CalendarNext') != null;
}

async function loadCalendar(): Promise<CalendarModule | null> {
  if (!calendarModuleInstalled()) return null;
  try {
    return await import('expo-calendar');
  } catch {
    return null;
  }
}

async function eventCalendar(calendar: CalendarModule) {
  if (Platform.OS === 'ios') return calendar.getDefaultCalendarSync();
  const calendars = await calendar.getCalendars();
  return (
    calendars.find((item) => item.allowsModifications && item.isPrimary) ??
    calendars.find((item) => item.allowsModifications) ??
    null
  );
}

/** Opens the phone calendar. A cancel and a save both come back as done. */
export async function presentAddToCalendar(draft: CalendarDraft): Promise<'done' | 'unavailable'> {
  if (Platform.OS === 'web') return 'unavailable';
  const calendar = await loadCalendar();
  if (!calendar) throw new Error('calendar_unavailable');
  const permission = await calendar.requestCalendarPermissions(Platform.OS === 'ios');
  if (permission.status !== 'granted') throw new Error('calendar_unavailable');
  const target = await eventCalendar(calendar);
  if (!target) throw new Error('calendar_unavailable');
  await target.addEventWithForm({
    title: draft.title,
    startDate: new Date(draft.startDate),
    endDate: new Date(draft.endDate),
    allDay: draft.allDay,
    location: draft.location,
    notes: draft.notes,
    url: draft.url,
  });
  return 'done';
}
