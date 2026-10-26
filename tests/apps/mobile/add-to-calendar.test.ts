import { describe, expect, it } from 'vitest';

import { calendarDraft } from '../../../apps/mobile/src/lib/calendar-draft';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('calendarDraft', () => {
  it('keeps a timed occasion and leaves empty extras out', () => {
    expect(
      calendarDraft({
        title: 'Concert',
        startsAt: '2026-12-06T17:00:00.000Z',
        endsAt: '2026-12-06T18:20:00.000Z',
        allDay: false,
        location: 'Glysis',
        notes: null,
        timeZone: 'Europe/Stockholm',
        url: null,
      }),
    ).toEqual({
      title: 'Concert',
      startDate: '2026-12-06T17:00:00.000Z',
      endDate: '2026-12-06T18:20:00.000Z',
      allDay: false,
      location: 'Glysis',
      timeZone: 'Europe/Stockholm',
    });
  });

  it('gives a whole day an end on the next day', () => {
    const draft = calendarDraft({
      title: 'Market',
      startsAt: '2026-12-06T00:00:00.000Z',
      endsAt: '2026-12-06T00:00:00.000Z',
      allDay: true,
      location: null,
      notes: 'https://example.com/events/1',
      timeZone: null,
      url: 'https://example.com/events/1',
    });
    expect(draft.allDay).toBe(true);
    expect(new Date(draft.endDate).getTime() - new Date(draft.startDate).getTime()).toBe(DAY_MS);
    expect(draft.location).toBeUndefined();
    expect(draft.notes).toBe('https://example.com/events/1');
  });
});
