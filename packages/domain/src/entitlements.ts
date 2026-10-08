/**
 * Plan entitlements. v1 is free for everyone with no subscription option anywhere in the
 * product: every publisher resolves to LAUNCH_PLAN, which unlocks everything. Paid tiers
 * (free/small/medium/large) are a future feature; enabling them should be a data change.
 */
export interface Entitlements {
  planSlug: string;
  eventsPerMonth: number | null; // null = unlimited
  pushNearby: boolean;
  ratingComments: boolean;
  featuredPerMonth: number;
  maxMembers: number | null;
  statsLevel: 'basic' | 'detailed' | 'detailed_export';
  hideAds: boolean;
}

export const LAUNCH_PLAN: Entitlements = {
  planSlug: 'launch',
  eventsPerMonth: null,
  pushNearby: true,
  ratingComments: true,
  featuredPerMonth: 0,
  maxMembers: null,
  statsLevel: 'detailed',
  hideAds: false,
};

export function entitlementsFor(_publisherId: string): Entitlements {
  return LAUNCH_PLAN;
}

export function canPublishAnother(ent: Entitlements, publishedThisMonth: number): boolean {
  return ent.eventsPerMonth === null || publishedThisMonth < ent.eventsPerMonth;
}
