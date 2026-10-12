/** Citybreak categories under Evenemang in the Visit Söderhamn fixture. A live import adds the rest. */
const VISIT_TAGS: { citybreakId: number; name: string; slug: string }[] = [
  { citybreakId: 30182, name: 'Högtider', slug: 'hogtider' },
  { citybreakId: 30184, name: 'Jul & Nyår', slug: 'jul-nyar' },
  { citybreakId: 30192, name: 'Idrott & Tävlingar', slug: 'idrott-tavlingar' },
  { citybreakId: 30194, name: 'Bandy & Innebandy', slug: 'bandy-innebandy' },
  { citybreakId: 30203, name: 'Tävlingar', slug: 'tavlingar' },
  { citybreakId: 30216, name: 'Mässor & Utställningar', slug: 'massor-utstallningar' },
  { citybreakId: 30224, name: 'Utställning', slug: 'utstallning' },
];

export type SeedTag = {
  id: string;
  slug: string;
  name: string;
  externalId: string;
};

/** UUID tied to the Citybreak id so memory stores and the seed migration match. */
export function visitTagId(citybreakId: number): string {
  return `a0000000-0000-4000-8000-${String(citybreakId).padStart(12, '0')}`;
}

export function visitTagExternalId(citybreakId: number): string {
  return `visit-soderhamn:${citybreakId}`;
}

export const SEED_TAGS: SeedTag[] = VISIT_TAGS.map((tag) => ({
  id: visitTagId(tag.citybreakId),
  slug: tag.slug,
  name: tag.name,
  externalId: visitTagExternalId(tag.citybreakId),
}));
