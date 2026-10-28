import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CALENDAR_DAY_POLL_MS,
  clampRangeToToday,
  monthOnNewDay,
  retainCalendarDay,
  selectionOnNewDay,
  watchCalendarDay,
} from '../../../apps/mobile/src/lib/calendar-today';
import type { DayStamp } from '../../../apps/mobile/src/lib/calendar-range';

const beforeMidnight = new Date('2026-10-28T22:30:00.000Z');
const afterMidnight = new Date('2026-10-28T23:30:00.000Z');
const october28: DayStamp = { y: 2026, m: 10, d: 28 };
const october29: DayStamp = { y: 2026, m: 10, d: 29 };

function fakeAppState() {
  const listeners = new Set<(state: string) => void>();
  return {
    emit(state: string) {
      for (const listener of listeners) listener(state);
    },
    addEventListener(_type: 'change', listener: (state: string) => void) {
      listeners.add(listener);
      return {
        remove: () => {
          listeners.delete(listener);
        },
      };
    },
  };
}

describe('calendar today', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the same day until Stockholm midnight', () => {
    expect(retainCalendarDay(october28, beforeMidnight)).toBe(october28);
    expect(retainCalendarDay(october28, afterMidnight)).toEqual(october29);
  });

  it('moves a past month up to today and leaves a later month', () => {
    expect(monthOnNewDay({ y: 2026, m: 9 }, october29)).toEqual({ y: 2026, m: 10 });
    expect(monthOnNewDay({ y: 2026, m: 12 }, october29)).toEqual({ y: 2026, m: 12 });
  });

  it('pulls a custom range up to today and drops one that has ended', () => {
    const today = october29;
    expect(clampRangeToToday({ from: october28, to: { y: 2026, m: 11, d: 2 } }, today)).toEqual({
      from: today,
      to: { y: 2026, m: 11, d: 2 },
    });
    expect(clampRangeToToday({ from: october28, to: october28 }, today)).toBeNull();
    const future = { from: { y: 2026, m: 11, d: 1 }, to: { y: 2026, m: 11, d: 2 } };
    expect(clampRangeToToday(future, today)).toBe(future);
  });

  it('clears a date-sheet selection that is now in the past', () => {
    expect(selectionOnNewDay(october28, october28, october29)).toEqual({ from: null, to: null });
    expect(selectionOnNewDay(october28, { y: 2026, m: 11, d: 2 }, october29)).toEqual({
      from: october29,
      to: { y: 2026, m: 11, d: 2 },
    });
  });

  it('reads today on start, on the interval, and when the app becomes active', () => {
    vi.useFakeTimers();
    let now = beforeMidnight;
    const days: DayStamp[] = [];
    const appState = fakeAppState();
    const stop = watchCalendarDay((day) => days.push(day), {
      now: () => now,
      everyMs: CALENDAR_DAY_POLL_MS,
      appState,
    });

    expect(days).toEqual([october28]);
    now = afterMidnight;
    vi.advanceTimersByTime(CALENDAR_DAY_POLL_MS);
    expect(days.at(-1)).toEqual(october29);

    now = new Date('2026-10-29T23:30:00.000Z');
    appState.emit('background');
    expect(days).toHaveLength(2);
    appState.emit('active');
    expect(days.at(-1)).toEqual({ y: 2026, m: 10, d: 30 });

    stop();
    vi.advanceTimersByTime(CALENDAR_DAY_POLL_MS);
    expect(days).toHaveLength(3);
  });
});
