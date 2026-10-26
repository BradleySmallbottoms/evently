import { Platform } from 'react-native';

import type { CalendarDraft } from './calendar-draft';

type CalendarModule = typeof import('expo-calendar');

/** The native module is missing until the development client is rebuilt. */
async function loadCalendar(): Promise<CalendarModule | null> {
  try {
    return await import('expo-calendar');
  } catch {
    return null;
  }
}

/** Opens the phone calendar. A cancel and a save both come back as done. */
export async function presentAddToCalendar(draft: CalendarDraft): Promise<'done' | 'unavailable'> {
  if (Platform.OS === 'web') return 'unavailable';
  const calendar = await loadCalendar();
  if (!calendar) throw new Error('calendar_unavailable');
  if (!(await calendar.isAvailableAsync())) return 'unavailable';
  await calendar.createEventInCalendarAsync({
    title: draft.title,
    startDate: new Date(draft.startDate),
    endDate: new Date(draft.endDate),
    allDay: draft.allDay,
    location: draft.location,
    notes: draft.notes,
    timeZone: draft.timeZone,
    url: draft.url,
  });
  return 'done';
}
