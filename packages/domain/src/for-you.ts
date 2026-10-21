/** How many of the latest saves, coming marks, and check-ins shape For you. No time window. */
export const FOR_YOU_RECENT_LIMIT = 20;

/** Cards in the home For you row. */
export const FOR_YOU_HOME_COUNT = 12;

/** Upcoming events loaded in the selected area before ranking. */
export const FOR_YOU_CANDIDATE_LIMIT = 100;

export type ForYouSignal = {
  id: string;
  tagIds: readonly string[];
  publisherId: string;
};

export type ForYouCandidate = ForYouSignal & {
  featured?: boolean;
};

/** The newest interactions of one kind. Callers pass lists already ordered newest first. */
export function recentForYouSignals<T>(items: readonly T[], limit = FOR_YOU_RECENT_LIMIT): T[] {
  return items.slice(0, limit);
}

/**
 * Upcoming events similar to the user's latest interactions, inside any selected tags.
 * A candidate qualifies when it shares a tag with those interactions or its publisher is followed.
 * Featured events and events the user already acted on are left out.
 * Ties keep the candidate order (soonest first).
 */
export function selectForYouEvents<T extends ForYouCandidate>(input: {
  candidates: readonly T[];
  signals: readonly ForYouSignal[];
  followedPublisherIds: readonly string[];
  selectedTagIds: readonly string[];
  /** Ids on screen in the featured row. Featured events are also skipped via `featured`. */
  featuredIds?: ReadonlySet<string>;
  /** Every event the user saved, is coming to, or checked in on. */
  excludeIds?: ReadonlySet<string>;
  limit?: number;
}): T[] {
  const taste = new Set(input.signals.flatMap((signal) => signal.tagIds));
  const acted = input.excludeIds ?? new Set(input.signals.map((signal) => signal.id));
  const followed = new Set(input.followedPublisherIds);
  const selected = input.selectedTagIds.length > 0 ? new Set(input.selectedTagIds) : null;
  const featuredIds = input.featuredIds ?? new Set<string>();
  const limit = input.limit ?? FOR_YOU_HOME_COUNT;

  const ranked: { item: T; shared: number; fromFollowed: boolean; index: number }[] = [];
  input.candidates.forEach((item, index) => {
    if (item.featured || featuredIds.has(item.id) || acted.has(item.id)) return;
    if (selected && !item.tagIds.some((id) => selected.has(id))) return;
    const shared = item.tagIds.reduce((count, id) => count + (taste.has(id) ? 1 : 0), 0);
    const fromFollowed = followed.has(item.publisherId);
    if (shared === 0 && !fromFollowed) return;
    ranked.push({ item, shared, fromFollowed, index });
  });

  ranked.sort(
    (a, b) =>
      b.shared - a.shared || Number(b.fromFollowed) - Number(a.fromFollowed) || a.index - b.index,
  );
  return ranked.slice(0, limit).map((row) => row.item);
}
