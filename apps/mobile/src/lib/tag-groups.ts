export const HOME_TAG_GROUPS = [
  {
    id: 'music',
    slugs: [
      'musik-underhallning',
      'konsert',
      'julkonsert',
      'festival',
      'soderhamns-kulturfestival',
      'spelmansstamma',
      'show',
      'fest',
      'bingo',
    ],
  },
  {
    id: 'sport',
    slugs: [
      'idrott',
      'idrott-tavlingar',
      'tavlingar',
      'fotboll',
      'hockey',
      'bandy-innebandy',
      'tennis',
      'golf',
      'bowling',
      'hastsport',
      'alpint-langdskidor',
      'skateboard',
      'motor',
      'cruising',
    ],
  },
  {
    id: 'culture',
    slugs: [
      'dans',
      'film-teater',
      'utstallning',
      'massor-utstallningar',
      'massa',
      'skapande-hantverk',
      'forelasningar-seminarier',
      'naringsliv',
      'uppvisning',
      'guidning',
      'vandringar',
      'halsingegard',
      'visitcenter',
      'oppet-hus',
      'traffar',
    ],
  },
  {
    id: 'family',
    slugs: ['barn-familj', 'barnaktivitet', 'lager', 'skollov', 'sportlov', 'pasklov', 'hostlov'],
  },
  {
    id: 'holiday',
    slugs: [
      'hogtider',
      'jul-nyar',
      'julskyltning',
      'julmarknad',
      'midsommar',
      'pask',
      'valborg',
      'internationella-hogtider',
      'gudstjanst',
    ],
  },
  {
    id: 'other',
    slugs: ['mat-dryck', 'julbord', 'forsaljning', 'auktion-marknad'],
  },
] as const;

export type HomeTagGroupId = (typeof HOME_TAG_GROUPS)[number]['id'];

const SLUG_GROUP = new Map<string, HomeTagGroupId>(
  HOME_TAG_GROUPS.flatMap((group) => group.slugs.map((slug) => [slug, group.id] as const)),
);

export type HomeTag = { id: string; slug: string; name: string };

export type HomeTagGroup = { id: HomeTagGroupId; tags: HomeTag[] };

/** Bucket tags into the home groups. A slug that is not listed lands in Övrigt. Empty groups are omitted. */
export function groupHomeTags(tags: readonly HomeTag[]): HomeTagGroup[] {
  const buckets = new Map<HomeTagGroupId, HomeTag[]>(HOME_TAG_GROUPS.map((group) => [group.id, []]));
  for (const tag of tags) {
    const groupId = SLUG_GROUP.get(tag.slug) ?? 'other';
    buckets.get(groupId)?.push(tag);
  }
  return HOME_TAG_GROUPS.flatMap((group) => {
    const items = buckets.get(group.id) ?? [];
    return items.length > 0 ? [{ id: group.id, tags: items }] : [];
  });
}

/** Select every tag in the group, or clear the group when all of them are already selected. */
export function toggleGroupSelection(selected: readonly string[], groupTagIds: readonly string[]): string[] {
  const next = new Set(selected);
  const allOn = groupTagIds.length > 0 && groupTagIds.every((id) => next.has(id));
  if (allOn) {
    for (const id of groupTagIds) next.delete(id);
  } else {
    for (const id of groupTagIds) next.add(id);
  }
  return [...next];
}

export function toggleTagSelection(selected: readonly string[], tagId: string): string[] {
  const next = new Set(selected);
  if (next.has(tagId)) next.delete(tagId);
  else next.add(tagId);
  return [...next];
}

const TAG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseHomeTagIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && TAG_ID.test(id));
  } catch {
    return [];
  }
}

/** Drop stored ids that are not in the current tag list. */
export function retainedTagIds(stored: readonly string[], knownIds: ReadonlySet<string>): string[] {
  return stored.filter((id) => knownIds.has(id));
}
