import type { EventMeta } from '@local-events/contracts';
import type { DuplicateSignal, EventStatus, MarketingPushPlanId, SourceTrust } from '@local-events/domain';
import type { IncomingEvent, TagChoice } from '@local-events/ingest';
import { type GeoPoint, type NearbyWindow } from '@local-events/geo';

/** Fixed search radius. The model cannot widen it. */
export const NEARBY_RADIUS_M = 5_000;
export const NEARBY_DAYS_BEFORE = 1;
export const NEARBY_DAYS_AFTER = 1;
export const NEARBY_RESULT_LIMIT = 20;

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
  verified: boolean;
  temporary: boolean;
  nearestEventTitle: string;
  distanceM: number;
  organizerKeys: string[];
}

export interface PublisherCandidate {
  publisherId: string;
  sourceId: string | null;
  key: string;
  verified: boolean;
  createdAt: number;
  near: boolean;
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
  verified: boolean;
  createdAt: number;
  isTemporary: boolean;
  importNotificationPlan: MarketingPushPlanId | null;
  organizerKeys: string[];
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
  verified: boolean;
  createdAt: number;
  near: boolean;
  isTemporary: boolean;
  importNotificationPlan: MarketingPushPlanId | null;
  organizerKeys: string[];
  publisherName: string;
}

export interface PublisherLink {
  publisherId: string;
  isTemporary: boolean;
  verified: boolean;
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
  endsAt: string;
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
  nearbyEvents(point: GeoPoint, window: NearbyWindow, excludeEventId: string): Promise<NearbyEventHit[]>
  nearbyPublishers(point: GeoPoint, window: NearbyWindow, excludeEventId: string): Promise<NearbyPublisherHit[]>;
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
  /** Store keys from this event on the publisher when this source does not already use them. */
  rememberOrganizerKeys(
    sourceId: string,
    publisherId: string,
    organizerKeys: string[],
  ): Promise<void>;
  getPublisher(publisherId: string): Promise<PublisherRecord | null>;
  getEvent(eventId: string): Promise<EventRecord | null>;
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
  /**
   * Claims up to `limit` `pending_scan` rows whose lease is free.
   * `eventId` claims that one row when it is still `pending_scan` and the lease is free.
   * The rows stay `pending_scan` until {@link finishImportedScan}.
   */
  claimPendingScans(limit: number, leaseMs: number, eventId?: string): Promise<PendingScanRow[]>;
  /** Drops this claim so a later run can take the row again. */
  releaseScanClaim(eventId: string, claimedUntil: Date): Promise<void>;
  /**
   * Writes the scan result while this claim still holds the row.
   * Returns false when a newer import or a newer claim owns it.
   */
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
  }): Promise<boolean>;
}

export interface PendingScanRow {
  eventId: string;
  title: string;
  description: string | null;
  venueName: string | null;
  startsAt: Date;
  endsAt: Date;
  location: { lat: number; lng: number } | null;
  sourceUrl: string | null;
  links: string[];
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
