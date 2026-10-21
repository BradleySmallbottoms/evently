import type { EventMeta } from '@local-events/contracts';
import type { PublisherLookup } from './prompt-runners/types';
import type {
  EventStatus,
  MarketingPushPlanId,
  PublisherStatus,
  SourceTrust,
} from '@local-events/domain';
import type { IncomingEvent, TagChoice } from '@local-events/ingest';
import { type GeoPoint, type NearbyWindow } from '@local-events/geo';

/** Nearby event and publisher tools. The model cannot widen it. */
export const NEARBY_RADIUS_M = 500;
/** Name search only returns publishers that have an event inside this radius. */
export const PUBLISHER_NAME_SEARCH_RADIUS_M = 50_000;
export const NEARBY_DAYS_BEFORE = 3;
export const NEARBY_DAYS_AFTER = 3;
export const NEARBY_RESULT_LIMIT = 20;

/**
 * `*` matches any text and `?` matches one character. `%` and `_` in the name are literal.
 * A blank pattern, or one with no letter or number, is an error so `*` cannot list everyone.
 */
export function publisherNameMatcher(
  raw: string,
): { like: string; matches: (name: string) => boolean } | { error: string } {
  const pattern = raw.trim();
  if (!pattern) return { error: 'name is required.' };
  const literal = pattern.replace(/[*?]/g, '');
  if (!/[0-9A-Za-z\u00C0-\u024F]/.test(literal)) {
    return { error: 'name needs at least one letter or number.' };
  }
  let like = '';
  let regex = '^';
  for (const char of pattern) {
    if (char === '*') {
      like += '%';
      regex += '.*';
      continue;
    }
    if (char === '?') {
      like += '_';
      regex += '.';
      continue;
    }
    like += escapeLike(char);
    regex += escapeRegex(char);
  }
  const expression = new RegExp(`${regex}$`, 'iu');
  return { like, matches: (name) => expression.test(name) };
}

/** LIKE metacharacters are literal. `!` is the escape character used in the query. */
function escapeLike(char: string): string {
  if (char === '!' || char === '%' || char === '_') return `!${char}`;
  return char;
}

function escapeRegex(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

export interface NearbyEventHit {
  id: string;
  title: string;
  startsAt: string;
  venue: string | null;
  distanceM: number;
}

export interface NearbyPublisherHit {
  id: string;
  name: string;
  status: PublisherStatus;
  temporary: boolean;
  nearestEventTitle: string;
  distanceM: number;
  organizerKeys: string[];
}

export interface PublisherCandidate {
  publisherId: string;
  sourceId: string | null;
  key: string;
  status: PublisherStatus;
  createdAt: number;
  distanceMeters: number;
  isTemporary: boolean;
  organizerKeys: string[];
  publisherName: string;
}

export interface SourceRecord {
  id: string;
  slug: string;
  trust: SourceTrust;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface PublisherRecord {
  id: string;
  status: PublisherStatus;
  createdAt: number;
  isTemporary: boolean;
  importNotificationPlan: MarketingPushPlanId | null;
  organizerKeys: string[];
  /** Web lookup for a temporary publisher. Null until that prompt returns. */
  lookup: PublisherLookup | null;
}

export interface OccasionGroupRow {
  eventId: string;
  occasionGroupId?: string;
  possibleOccasionGroupId?: string;
}

export interface EventRecord {
  eventId: string;
  title: string;
  startsAt: string;
  refId: string | null;
  workerId: string | null;
}

export interface ScanPublisherCandidate {
  publisherId: string;
  sourceId: string | null;
  key: string;
  status: PublisherStatus;
  createdAt: number;
  distanceMeters: number;
  isTemporary: boolean;
  importNotificationPlan: MarketingPushPlanId | null;
  organizerKeys: string[];
  publisherName: string;
}

export interface PublisherLink {
  publisherId: string;
  isTemporary: boolean;
  status: PublisherStatus;
  importNotificationPlan: MarketingPushPlanId | null;
}

export interface ExternalRefHit {
  eventId: string;
  contentHash: string;
  status: EventStatus;
}

export interface DuplicateCandidate {
  eventId: string;
  title: string;
  startsAt: Date;
  location: { lat: number; lng: number };
  sourceUrl: string | null;
  links: string[];
  refId: string | null;
  workerId: string | null;
  externalIds: string[];
  distanceM: number;
}

export interface ImportedEventWrite {
  sourceId: string;
  externalId: string;
  contentHash: string;
  publisherId: string | null;
  status: EventStatus;
  event: IncomingEvent;
  endsAt: string | null;
  tagIds: string[];
  refId: string;
  workerId: string;
}

export interface IngestStore {
  getSource(slug: string): Promise<SourceRecord | null>;
  startRun(sourceId: string): Promise<string>;
  finishRun(
    runId: string,
    result: {
      status: string;
      fetched: number;
      created: number;
      updated: number;
      skipped: number;
      error: string | null;
    },
  ): Promise<void>;
  nearbyEvents(
    point: GeoPoint,
    window: NearbyWindow,
    excludeEventId: string,
  ): Promise<NearbyEventHit[]>;
  nearbyPublishers(
    point: GeoPoint,
    window: NearbyWindow,
    excludeEventId: string,
  ): Promise<NearbyPublisherHit[]>;
  /**
   * Publishers whose name matches `name` (`*` any text, `?` one character) and that
   * have an event within {@link PUBLISHER_NAME_SEARCH_RADIUS_M} of `point`.
   */
  publishersByName(
    point: GeoPoint,
    name: string,
    excludeEventId: string,
  ): Promise<NearbyPublisherHit[]>;
  /**
   * This source's alias wins. Otherwise an email or website from any source.
   * A name or slug matches only when that publisher has an event near `location`.
   */
  /** Alias, name, and nearby rows the scan runner chooses from. */
  listPublisherCandidates(
    sourceId: string,
    organizerKeys: string[],
    near?: {
      location?: { lat: number; lng: number };
      localSlugs?: string[];
    },
  ): Promise<ScanPublisherCandidate[]>;
  findPublisher(
    sourceId: string,
    organizerKeys: string[],
    near?: {
      location?: { lat: number; lng: number };
      localSlugs?: string[];
    },
  ): Promise<PublisherLink | null>;
  createTemporaryPublisher(input: {
    sourceId: string;
    organizerKeys: string[];
    name: string;
  }): Promise<PublisherLink>;
  /** Writes `meta.lookup` and leaves every other meta key as it is. */
  rememberPublisherLookup(publisherId: string, lookup: PublisherLookup): Promise<void>;
  /** Store keys from this event on the publisher when this source does not already use them. */
  rememberOrganizerKeys(
    sourceId: string,
    publisherId: string,
    organizerKeys: string[],
  ): Promise<void>;
  getPublisher(publisherId: string): Promise<PublisherRecord | null>;
  getEvent(eventId: string): Promise<EventRecord | null>;
  /** Occasion ids already stored on these events. Missing ids are left out. */
  listOccasionGroups(eventIds: string[]): Promise<OccasionGroupRow[]>;
  /** Sets `meta.possibleOccasionGroupId` and leaves every other meta key as it is. */
  setPossibleOccasionGroup(eventIds: string[], groupId: string): Promise<void>;
  findExternalRef(sourceId: string, externalId: string): Promise<ExternalRefHit | null>;
  /** True when an admin deleted this source id from review, so a later import must skip it. */
  isImportSuppressed(sourceId: string, externalId: string): Promise<boolean>;
  /** True when this source's publisher alias owns the event, so a re-import may update it. */
  sourceOwnsEvent(sourceId: string, eventId: string): Promise<boolean>;
  /** Live events within 200 m whose start is within 30 minutes. */
  listDuplicateCandidates(input: {
    location: { lat: number; lng: number };
    startsAt: Date;
  }): Promise<DuplicateCandidate[]>;
  upsertTags(tags: { externalId: string; name: string }[]): Promise<void>;
  /** Existing tag vocabulary, used when a source matches events onto tags. */
  listTags(): Promise<{ externalId: string; name: string; slug: string }[]>;
  /** Tags already attached to this source's events, one row per tag. */
  listEventTags(
    sourceId: string,
  ): Promise<{ externalId: string; tag: { externalId: string; name: string } }[]>;
  tagIdsForExternalIds(externalIds: string[]): Promise<string[]>;
  insertImported(input: ImportedEventWrite): Promise<string>;
  /**
   * Returns false when a `pending_scan` refresh loses to a scan that already
   * finished the row. The event and its content hash stay as the scan left them.
   */
  updateImported(eventId: string, input: ImportedEventWrite): Promise<boolean>;
  /** Schedule the publisher's import notification plan for one imported event. */
  scheduleImportNotifications?(input: {
    eventId: string;
    eventTitle: string;
    startsAt: Date;
    planId: MarketingPushPlanId;
    /** Event status after this import. Published rows are approved; others stay pending. */
    status: EventStatus;
  }): Promise<void>;
  touchRef(sourceId: string, externalId: string): Promise<void>;
  /** Record a new hash on an existing ref without changing which event it points at. */
  noteRef(sourceId: string, externalId: string, contentHash: string): Promise<void>;
  findEventImage(
    eventId: string,
    role?: string,
  ): Promise<{ sourceUrl: string | null; s3Key: string } | null>;
  listEventImages(
    eventId: string,
  ): Promise<{ role: string; sourceUrl: string | null; s3Key: string }[]>;
  saveEventImage(input: {
    eventId: string;
    role?: string;
    s3Key: string;
    sourceUrl: string;
    contentType: string;
  }): Promise<void>;
  /** Removes gallery rows. Never removes the hero (`main`). */
  deleteEventImages(eventId: string, roles: string[]): Promise<void>;
  /** `pending_scan` rows whose lease is free. `eventId` counts that one row. */
  countPendingScans(eventId?: string): Promise<number>;
  /**
   * Claims up to `limit` `pending_scan` rows whose lease is free.
   * `eventId` claims that one row when it is still `pending_scan` and the lease is free.
   * `skipEventIds` leaves those rows for a later run.
   * The rows stay `pending_scan` until {@link finishImportedScan}.
   */
  claimPendingScans(
    limit: number,
    leaseMs: number,
    eventId?: string,
    skipEventIds?: readonly string[],
  ): Promise<PendingScanRow[]>;
  /** Drops this claim so a later run can take the row again. */
  releaseScanClaim(eventId: string, claimedUntil: Date): Promise<void>;
  /**
   * Writes the scan result while this claim still holds the row.
   * Returns false when a newer import or a newer claim owns it.
   */
  /** `pending_scan` publishers whose lease is free. `publisherId` counts that one row. */
  countPendingPublisherScans(publisherId?: string): Promise<number>;
  /**
   * Claims up to `limit` `pending_scan` publishers whose lease is free.
   * The rows stay `pending_scan` until {@link finishPublisherScan}.
   */
  claimPendingPublisherScans(
    limit: number,
    leaseMs: number,
    publisherId?: string,
    skipPublisherIds?: readonly string[],
  ): Promise<PendingPublisherRow[]>;
  /** Drops this claim so a later run can take the publisher again. */
  releasePublisherScanClaim(publisherId: string, claimedUntil: Date): Promise<void>;
  /**
   * Moves the publisher to `in_review` while this claim still holds it.
   * Returns false when an admin already published it or a newer claim owns it.
   */
  finishPublisherScan(input: {
    publisherId: string;
    claimedUntil: Date;
    lookup: PublisherLookup | null;
  }): Promise<boolean>;
  finishImportedScan(input: {
    eventId: string;
    publisherId: string;
    status: 'in_review' | 'published';
    meta: EventMeta;
    tagIds: string[];
    llmOutput: object;
    contentVerdict: 'spam' | 'harmful' | 'safe' | 'unknown';
    /** Null when the scan did not write one. */
    summary: string | null;
    /** `en` when the scan says English. Anything else is `sv`. */
    language: 'sv' | 'en';
    claimedUntil: Date;
    /** Set only when the scan found both and the row had neither. */
    startsAt?: Date;
    endsAt?: Date;
    /** Set only when the row had no point and the page lookup found one. */
    location?: { lat: number; lng: number };
    /** Set only when the row had no venue name and the scan chose one. */
    venueName?: string;
  }): Promise<boolean>;
}

export interface PendingScanRow {
  eventId: string;
  title: string;
  description: string | null;
  venueName: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  location: { lat: number; lng: number } | null;
  sourceUrl: string | null;
  links: string[];
  pageLinks: { type: 'tickets' | 'registration' | 'info' | 'facebook'; url: string }[];
  externalId: string;
  workerId: string;
  tagIds: string[];
  tags: TagChoice[];
  meta: EventMeta;
  sourceId: string;
  sourceSlug: string;
  sourceTrust: SourceTrust;
  /** Lease timestamp written by the claim. Finish and release match this value. */
  claimedUntil: Date;
}

/** One unscanned publisher plus the newest linked event, when one exists. */
export interface PendingPublisherRow {
  publisherId: string;
  name: string;
  organizerKeys: string[];
  claimedUntil: Date;
  sourceId: string | null;
  sourceSlug: string | null;
  title: string | null;
  description: string | null;
  venueName: string | null;
  location: { lat: number; lng: number } | null;
  sourceUrl: string | null;
}
