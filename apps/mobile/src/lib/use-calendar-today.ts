import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { compareStamps, partsInZone, type DayStamp } from '@/lib/calendar-range';
import { CALENDAR_DAY_POLL_MS, watchCalendarDay } from '@/lib/calendar-today';

/** Stockholm today, refreshed on mount, when the tab is shown, and on a timer. */
export function useCalendarToday(): DayStamp {
  const [today, setToday] = useState(() => partsInZone(new Date()));
  const apply = useCallback((next: DayStamp) => {
    setToday((current) => (compareStamps(current, next) === 0 ? current : next));
  }, []);

  useEffect(() => {
    return watchCalendarDay(apply, {
      now: () => new Date(),
      everyMs: CALENDAR_DAY_POLL_MS,
      appState: AppState,
    });
  }, [apply]);

  useFocusEffect(
    useCallback(() => {
      apply(partsInZone(new Date()));
    }, [apply]),
  );

  return today;
}
