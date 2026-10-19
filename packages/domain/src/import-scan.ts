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
  occasionGroupId?: string;
  possibleOccasionGroupId?: string;
}

/**
 * Id to store on `meta.possibleOccasionGroupId` for this scan.
 * A duplicate counts only when its occasion rank is over {@link OCCASION_GROUP_MIN_RANK}.
 * An `occasionGroupId` already on the scanned event or one of those duplicates is reused.
 * The scanned event wins when several product ids are set. Otherwise an existing
 * `possibleOccasionGroupId` is reused. `newId` is used only when none of those is set.
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
  return firstGroupId(members, 'occasionGroupId') ?? firstGroupId(members, 'possibleOccasionGroupId') ?? input.newId;
}

function firstGroupId(
  members: OccasionGroupMember[],
  key: 'occasionGroupId' | 'possibleOccasionGroupId',
): string | undefined {
  for (const member of members) {
    const value = member[key]?.trim();
    if (value) return value;
  }
  return undefined;
}
