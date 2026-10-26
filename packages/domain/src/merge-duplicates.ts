/** A kept event records each duplicate it hid. */
export type MergedDuplicate = {
  eventId: string;
  title: string;
};

/** Meta fields this merge reads and writes. Other keys stay. */
export type StoredDuplicateMeta = {
  possibleDuplicate?: { eventId: string };
  mergedDuplicates?: MergedDuplicate[];
  duplicateOf?: MergedDuplicate;
};

/**
 * Drop a duplicate note that points at an event whose occasions were folded in.
 * A note that points elsewhere stays. Other keys stay.
 */
export function metaWithoutFoldedDuplicate<T extends { possibleDuplicate?: { eventId: string } }>(
  meta: T,
  foldedEventIds: ReadonlySet<string>,
): T {
  const eventId = meta.possibleDuplicate?.eventId;
  if (!eventId || !foldedEventIds.has(eventId)) return meta;
  const { possibleDuplicate: _note, ...rest } = meta;
  return rest as T;
}

/** True when either event's duplicate note points at the other. */
export function eventsAreDuplicatePair(
  target: { id: string; possibleDuplicateEventId?: string },
  other: { id: string; possibleDuplicateEventId?: string },
): boolean {
  if (target.id === other.id) return false;
  return (
    target.possibleDuplicateEventId === other.id || other.possibleDuplicateEventId === target.id
  );
}

/**
 * Hide the chosen duplicates on the target. Their occasions stay put.
 * The target drops its duplicate warning when that warning points at one of
 * the hidden events, and records each hidden event on `mergedDuplicates`.
 */
export function hideMergedDuplicates<T extends StoredDuplicateMeta>(input: {
  target: { id: string; title: string; meta: T };
  duplicates: { id: string; title: string; meta: T }[];
}): { targetMeta: T; duplicates: { id: string; meta: T }[] } {
  const hidden = new Set(input.duplicates.map((item) => item.id));
  const merged: MergedDuplicate[] = [...(input.target.meta.mergedDuplicates ?? [])];
  for (const item of input.duplicates) {
    if (merged.some((row) => row.eventId === item.id)) continue;
    if (merged.length >= 100) break;
    merged.push({ eventId: item.id, title: item.title });
  }
  const pointedAt = input.target.meta.possibleDuplicate;
  const {
    possibleDuplicate: _dropped,
    mergedDuplicates: _previous,
    ...targetRest
  } = input.target.meta;
  const targetMeta = {
    ...targetRest,
    ...(pointedAt && !hidden.has(pointedAt.eventId) ? { possibleDuplicate: pointedAt } : {}),
    mergedDuplicates: merged,
  } as T;
  return {
    targetMeta,
    duplicates: input.duplicates.map((item) => {
      const { possibleDuplicate: _warning, duplicateOf: _mark, ...rest } = item.meta;
      return {
        id: item.id,
        meta: {
          ...rest,
          duplicateOf: { eventId: input.target.id, title: input.target.title },
        } as T,
      };
    }),
  };
}
