import { slugifyPublisherName } from './auth';
import { publisherIsPublished, type PublisherStatus } from './types';

/** Same display name or slug matches only when the publisher already has an event this close. */
export const PUBLISHER_NAME_RADIUS_M = 10_000;

const HOST_KEY = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type SharedOrganizerKeyKind = 'email' | 'host' | 'name' | 'local';

/** Email and website cross every source. A source slug stays on that source. Anything else is a name. */
export function sharedOrganizerKeyKind(
  key: string,
  localSlugs: readonly string[],
): SharedOrganizerKeyKind {
  if (localSlugs.includes(key)) return 'local';
  if (key.includes('@')) return 'email';
  if (websiteKey(key)) return 'host';
  return 'name';
}

/** A bare host, or that host plus a path. */
function websiteKey(key: string): boolean {
  const slash = key.indexOf('/');
  const host = slash === -1 ? key : key.slice(0, slash);
  return HOST_KEY.test(host);
}

export interface PublisherCandidate {
  publisherId: string;
  /** Set when the row is an alias. Null when it came from the publisher name or slug. */
  sourceId: string | null;
  key: string;
  status: PublisherStatus;
  createdAt: number;
  distanceMeters: number;
}

function prefer(rows: PublisherCandidate[]): PublisherCandidate | null {
  return rows.reduce<PublisherCandidate | null>((best, row) => {
    if (!best) return row;
    const rowPublished = publisherIsPublished(row.status);
    const bestPublished = publisherIsPublished(best.status);
    if (rowPublished !== bestPublished) return rowPublished ? row : best;
    return row.createdAt < best.createdAt ? row : best;
  }, null);
}

/**
 * This source's own alias wins. Otherwise an email or website from any source.
 * A name or slug matches only when `near` is set, meaning the publisher has an
 * event within {@link PUBLISHER_NAME_RADIUS_M}. A source slug never crosses sources.
 * Two hits on the same key: the published publisher, otherwise the older one.
 */
export function choosePublisher(
  sourceId: string,
  keys: string[],
  localSlugs: readonly string[],
  candidates: PublisherCandidate[],
): PublisherCandidate | null {
  for (const key of keys) {
    const own = prefer(candidates.filter((row) => row.sourceId === sourceId && row.key === key));
    if (own) return own;
  }
  for (const key of keys) {
    const kind = sharedOrganizerKeyKind(key, localSlugs);
    if (kind !== 'email' && kind !== 'host') continue;
    const found = prefer(candidates.filter((row) => row.key === key));
    if (found) return found;
  }
  for (const key of keys) {
    if (sharedOrganizerKeyKind(key, localSlugs) !== 'name') continue;
    const slug = slugifyPublisherName(key);
    const found = prefer(
      candidates.filter((row) => row.distanceMeters > -1 && (row.key === key || row.key === slug)),
    );
    if (found) return found;
  }
  return null;
}
