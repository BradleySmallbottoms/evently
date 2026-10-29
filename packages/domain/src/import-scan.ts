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

/** A venue guess beats an imported name only when its rank is over this. */
export const VENUE_NAME_MIN_RANK = 80;

/** When no imported name exists, a guess over this rank is still written. */
export const VENUE_NAME_FALLBACK_MIN_RANK = 50;
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

export interface DatedOccasion {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Showings from the scan that are not already stored.
 * A match is the same start and the same end. A later showing in the same list
 * with those times is skipped too. A range with no end, or an end before the
 * start, is skipped.
 */
export function occasionsToAdd<T extends DatedOccasion>(
  existing: DatedOccasion[],
  possible: T[],
): T[] {
  const seen = new Set<string>();
  for (const occasion of existing) {
    const key = occasionKey(occasion);
    if (key) seen.add(key);
  }
  const added: T[] = [];
  for (const occasion of possible) {
    const key = occasionKey(occasion);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    added.push(occasion);
  }
  return added;
}

function occasionKey(occasion: DatedOccasion): string | null {
  const start = occasion.startsAt.getTime();
  const end = occasion.endsAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return `${start}:${end}`;
}

function bestVenueName(
  possible: PossibleVenueName[] | undefined,
  minRank: number,
): string | undefined {
  let best: { name: string; rank: number } | undefined;
  for (const item of possible ?? []) {
    const name = cleanVenueName(item.name);
    if (!name || !Number.isFinite(item.rank) || item.rank <= minRank) continue;
    if (!best || item.rank > best.rank) best = { name, rank: item.rank };
  }
  return best?.name;
}

/** Same place after trimming. Case differs; accents do not. */
export function venueNamesMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = cleanVenueName(left);
  const b = cleanVenueName(right);
  if (!a || !b) return false;
  return a.localeCompare(b, 'sv', { sensitivity: 'accent' }) === 0;
}

/**
 * Venue to write after a scan. The highest rank over {@link VENUE_NAME_MIN_RANK}
 * wins, then an arena name, then an imported venue that is not only `city`.
 * The highest rank over {@link VENUE_NAME_FALLBACK_MIN_RANK} wins over that
 * city. The city is used when the model returns none.
 */
export function venueNameFromScan(
  possible: PossibleVenueName[] | undefined,
  imported?: { arenaName?: string | null; venueName?: string | null } | null,
  city?: string | null,
): string | undefined {
  const strong = bestVenueName(possible, VENUE_NAME_MIN_RANK);
  if (strong) return strong;
  const arena = cleanVenueName(imported?.arenaName);
  if (arena) return arena;
  const importedName = cleanVenueName(imported?.venueName);
  const fallback = bestVenueName(possible, VENUE_NAME_FALLBACK_MIN_RANK);
  if (importedName && !venueNamesMatch(importedName, city)) return importedName;
  return fallback ?? importedName;
}

/**
 * Venue stored on one occasion when an import replaces the showing rows.
 * After the scan has finished, the name it wrote stays. Before that, the
 * incoming showing name is used. A new showing with no name of its own takes
 * the name already stored on another showing of the same event.
 */
export function occasionVenueOnImport(input: {
  scanned: boolean;
  incoming: string | null;
  previousForKey: string | null;
  previousAny: string | null;
}): string | null {
  const previous = input.previousForKey ?? input.previousAny;
  if (input.scanned) return previous ?? input.incoming;
  return input.incoming ?? previous;
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
