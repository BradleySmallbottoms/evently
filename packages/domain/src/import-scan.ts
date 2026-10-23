import type { SourceTrust } from './publishing';
import { publisherIsPublished, type EventStatus, type PublisherStatus } from './types';

export type ImportScanStatus = Extract<EventStatus, 'in_review' | 'published'>;

/**
 * Status after the import scan finishes.
 * Published needs an approved scan, a published publisher that is not temporary,
 * and an auto-publish source. A possible duplicate stays in review.
 */
export function statusAfterImportScan(input: {
  approved: boolean;
  publisherStatus: PublisherStatus;
  publisherIsTemporary: boolean;
  sourceTrust: SourceTrust;
  possibleDuplicate: boolean;
}): ImportScanStatus {
  if (
    input.possibleDuplicate ||
    !input.approved ||
    input.publisherIsTemporary ||
    !publisherIsPublished(input.publisherStatus) ||
    input.sourceTrust === 'review'
  ) {
    return 'in_review';
  }
  return 'published';
}

/** Another showing, not the same one. Matches the tag and publisher cutoff. */
export const OCCASION_GROUP_MIN_RANK = 90;

export interface OccasionGroupMember {
  possibleOccasionGroupId?: string;
}

/**
 * Id to store on `meta.possibleOccasionGroupId` for this scan.
 * A duplicate counts only when its occasion rank is over {@link OCCASION_GROUP_MIN_RANK}.
 * An existing `possibleOccasionGroupId` on the scanned event or one of those duplicates is reused.
 * `newId` is used only when none of those is set.
 * Returns null when no duplicate clears the rank, so a later scan does not clear a group.
 */
export function choosePossibleOccasionGroupId(input: {
  event: OccasionGroupMember;
  duplicates: (OccasionGroupMember & { occasionRank: number })[];
  newId: string;
}): string | null {
  const matches = input.duplicates
    .filter((item) => item.occasionRank > OCCASION_GROUP_MIN_RANK)
    .sort((a, b) => b.occasionRank - a.occasionRank);
  if (matches.length === 0) return null;
  const members = [input.event, ...matches];
  return firstGroupId(members, 'possibleOccasionGroupId') ?? input.newId;
}

/** A venue guess counts only when its rank is over this. Same cutoff as a publisher match. */
export const VENUE_NAME_MIN_RANK = 80;
const VENUE_NAME_LIMIT = 200;

export interface PossibleVenueName {
  name: string;
  rank: number;
}

function cleanVenueName(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const name = value.replace(/\s+/g, ' ').trim().slice(0, VENUE_NAME_LIMIT);
  return name || undefined;
}

/**
 * Place name passed to the scan as its location, and used when the model
 * returns no venue above {@link VENUE_NAME_MIN_RANK}. An arena name wins.
 */
export function importedVenueName(
  input: { arenaName?: string | null; venueName?: string | null } | null | undefined,
): string | undefined {
  return cleanVenueName(input?.arenaName) ?? cleanVenueName(input?.venueName);
}

/**
 * Venue to write after a scan. The highest rank over {@link VENUE_NAME_MIN_RANK}
 * wins. Otherwise {@link importedVenueName}.
 */
export function venueNameFromScan(
  possible: PossibleVenueName[] | undefined,
  imported?: { arenaName?: string | null; venueName?: string | null } | null,
): string | undefined {
  let best: { name: string; rank: number } | undefined;
  for (const item of possible ?? []) {
    const name = cleanVenueName(item.name);
    if (!name || !Number.isFinite(item.rank) || item.rank <= VENUE_NAME_MIN_RANK) continue;
    if (!best || item.rank > best.rank) best = { name, rank: item.rank };
  }
  return best?.name ?? importedVenueName(imported);
}

function firstGroupId(
  members: OccasionGroupMember[],
  key: 'possibleOccasionGroupId',
): string | undefined {
  for (const member of members) {
    const value = member[key]?.trim();
    if (value) return value;
  }
  return undefined;
}
