/**
 * Tag filter for a public event list.
 * `any` keeps an event that has one of the ids.
 * `primary` keeps it only when its first saved tag is one of the ids.
 * An empty filter matches every event.
 */
export function eventMatchesTagIds(
  tagIds: readonly string[],
  filterIds: readonly string[],
  match: 'any' | 'primary' = 'any',
): boolean {
  if (filterIds.length === 0) return true;
  if (match === 'primary') {
    const first = tagIds[0];
    return first != null && filterIds.includes(first);
  }
  const wanted = new Set(filterIds);
  return tagIds.some((id) => wanted.has(id));
}

/** Stable slug for a tag name. Swedish letters are folded so slugs stay ASCII. */
export function tagSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/é/g, 'e')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 80) || 'tag';
}
