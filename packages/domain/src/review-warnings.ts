import type { DuplicateSignal } from './duplicates';

/** A reason the review queue should mark an event. */
export type ReviewWarning = {
  code: 'possible_duplicate';
  eventId: string;
  title: string;
  matchedOn: DuplicateSignal;
};

/**
 * Reasons an import needs a closer look. A possible duplicate is the only
 * reason today; the list stays empty when the event looks fine.
 */
export function reviewWarnings(meta: {
  possibleDuplicate?: {
    eventId: string;
    title: string;
    matchedOn: DuplicateSignal;
  };
}): ReviewWarning[] {
  const duplicate = meta.possibleDuplicate;
  if (!duplicate) return [];
  return [
    {
      code: 'possible_duplicate',
      eventId: duplicate.eventId,
      title: duplicate.title,
      matchedOn: duplicate.matchedOn,
    },
  ];
}
