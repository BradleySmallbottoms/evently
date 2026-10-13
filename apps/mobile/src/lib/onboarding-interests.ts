import type { HomeTag } from '@/lib/tag-groups';

/** Interest cards on the last onboarding step. Slugs are a partition of the home tag groups. */
export const ONBOARDING_INTERESTS = [
  {
    id: 'music',
    slugs: [
      'musik-underhallning',
      'konsert',
      'julkonsert',
      'festival',
      'soderhamns-kulturfestival',
      'spelmansstamma',
      'fest',
      'bingo',
    ],
  },
  { id: 'theatre', slugs: ['film-teater', 'dans', 'show', 'uppvisning'] },
  { id: 'training', slugs: ['tennis', 'golf', 'bowling', 'skateboard', 'alpint-langdskidor'] },
  { id: 'museum', slugs: ['utstallning', 'massor-utstallningar', 'visitcenter', 'halsingegard'] },
  { id: 'outdoor', slugs: ['vandringar', 'guidning'] },
  { id: 'food', slugs: ['mat-dryck', 'julbord'] },
  {
    id: 'family',
    slugs: ['barn-familj', 'barnaktivitet', 'lager', 'skollov', 'sportlov', 'pasklov', 'hostlov'],
  },
  { id: 'photo', slugs: ['skapande-hantverk'] },
  {
    id: 'sport',
    slugs: [
      'idrott',
      'idrott-tavlingar',
      'tavlingar',
      'fotboll',
      'hockey',
      'bandy-innebandy',
      'hastsport',
      'motor',
      'cruising',
    ],
  },
  { id: 'market', slugs: ['auktion-marknad', 'forsaljning', 'julmarknad', 'massa'] },
  { id: 'talks', slugs: ['forelasningar-seminarier', 'naringsliv'] },
  {
    id: 'local',
    slugs: [
      'traffar',
      'oppet-hus',
      'gudstjanst',
      'hogtider',
      'jul-nyar',
      'julskyltning',
      'midsommar',
      'pask',
      'valborg',
      'internationella-hogtider',
    ],
  },
] as const;

export type OnboardingInterestId = (typeof ONBOARDING_INTERESTS)[number]['id'];

const SLUGS_BY_INTEREST = new Map<OnboardingInterestId, ReadonlySet<string>>(
  ONBOARDING_INTERESTS.map((interest) => [interest.id, new Set<string>(interest.slugs)]),
);

/** Tags from the loaded list that belong to this interest, in list order. */
export function tagsForInterest(tags: readonly HomeTag[], interestId: OnboardingInterestId): HomeTag[] {
  const slugs = SLUGS_BY_INTEREST.get(interestId);
  if (!slugs) return [];
  return tags.filter((tag) => slugs.has(tag.slug));
}

/** Interests that can actually filter, in catalog order. */
export function visibleInterests(tags: readonly HomeTag[]): OnboardingInterestId[] {
  return ONBOARDING_INTERESTS.flatMap((interest) =>
    tagsForInterest(tags, interest.id).length > 0 ? [interest.id] : [],
  );
}

/** A card is on when every loaded tag in that interest is selected. */
export function isInterestSelected(
  selectedIds: readonly string[],
  interestTagIds: readonly string[],
): boolean {
  if (interestTagIds.length === 0) return false;
  const selected = new Set(selectedIds);
  return interestTagIds.every((id) => selected.has(id));
}
