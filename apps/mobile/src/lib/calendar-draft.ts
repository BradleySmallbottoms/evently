const DAY_MS = 24 * 60 * 60 * 1000;

export type CalendarDraft = {
  title: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  timeZone?: string;
  url?: string;
};

/** Fields for the system calendar sheet. A whole day ends the next day. */
export function calendarDraft(input: {
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  timeZone: string | null;
  url: string | null;
}): CalendarDraft {
  const start = new Date(input.startsAt);
  let end = new Date(input.endsAt);
  if (!Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + (input.allDay ? DAY_MS : 60 * 60 * 1000));
  } else if (input.allDay && end.getTime() - start.getTime() < DAY_MS) {
    end = new Date(start.getTime() + DAY_MS);
  }
  return {
    title: input.title,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    allDay: input.allDay,
    ...(input.location ? { location: input.location } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    ...(input.url ? { url: input.url } : {}),
  };
}
