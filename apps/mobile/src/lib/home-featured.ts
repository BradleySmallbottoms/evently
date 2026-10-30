/** Home carousel. Only featured events, in list order, at most `limit`. */
export function pickHomeFeaturedEvents<T extends { featured: boolean }>(
  items: readonly T[],
  limit = 6,
): T[] {
  return items.filter((event) => event.featured).slice(0, limit);
}
