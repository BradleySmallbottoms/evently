import type { Category } from '@local-events/contracts';

/** Default categories for local/dev and memory store until a full taxonomy is curated. */
export const SEED_CATEGORIES: Category[] = [
  {
    id: '11111111-1111-4111-8111-111111111101',
    slug: 'music',
    parentId: null,
    nameSv: 'Musik',
    nameEn: 'Music',
  },
  {
    id: '11111111-1111-4111-8111-111111111102',
    slug: 'culture',
    parentId: null,
    nameSv: 'Kultur',
    nameEn: 'Culture',
  },
  {
    id: '11111111-1111-4111-8111-111111111103',
    slug: 'sports',
    parentId: null,
    nameSv: 'Sport',
    nameEn: 'Sports',
  },
  {
    id: '11111111-1111-4111-8111-111111111104',
    slug: 'social',
    parentId: null,
    nameSv: 'Socialt',
    nameEn: 'Social',
  },
  {
    id: '11111111-1111-4111-8111-111111111105',
    slug: 'family',
    parentId: null,
    nameSv: 'Familj',
    nameEn: 'Family',
  },
  {
    id: '11111111-1111-4111-8111-111111111106',
    slug: 'food',
    parentId: null,
    nameSv: 'Mat & dryck',
    nameEn: 'Food & drink',
  },
];
