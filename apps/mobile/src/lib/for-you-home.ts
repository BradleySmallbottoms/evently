/** Cards shown in the home For you carousel. */
export const FOR_YOU_HOME_COUNT = 12;

/**
 * Featured events sort first, and the home list page holds this many.
 * The For you request asks for a full page of those plus the carousel,
 * so dropping the featured row still leaves {@link FOR_YOU_HOME_COUNT} cards.
 */
const HOME_LIST_PAGE = 20;

export const FOR_YOU_HOME_FETCH = FOR_YOU_HOME_COUNT + HOME_LIST_PAGE;

/** Home For you cards, skipping ids already shown in the featured row. */
export function forYouHomeItems<T extends { id: string }>(
  items: readonly T[],
  featuredIds: ReadonlySet<string>,
  count = FOR_YOU_HOME_COUNT,
): T[] {
  const picked: T[] = [];
  for (const item of items) {
    if (featuredIds.has(item.id)) continue;
    picked.push(item);
    if (picked.length === count) break;
  }
  return picked;
}
