import type { IncomingEvent } from '@local-events/ingest';
import type { EventStatus, MarketingPushPlanId, SourceTrust } from '@local-events/domain';

export interface SourceRecord {
  id: string;
  slug: string;
  trust: SourceTrust;
  config: Record<string, unknown>;
  enabled: boolean;
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
  publisherId: string;
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
  /** First alias for this source whose key appears in `organizerKeys`, in that order. */
  findPublisher(sourceId: string, organizerKeys: string[]): Promise<PublisherLink | null>;
  createTemporaryPublisher(input: {
    sourceId: string;
    organizerKeys: string[];
    name: string;
  }): Promise<PublisherLink>;
  /** Store keys from this event on the publisher when this source does not already use them. */
  rememberOrganizerKeys(sourceId: string, publisherId: string, organizerKeys: string[]): Promise<void>;
  findExternalRef(sourceId: string, externalId: string): Promise<ExternalRefHit | null>;
  /** True when an admin deleted this source id from review, so a later import must skip it. */
  isImportSuppressed(sourceId: string, externalId: string): Promise<boolean>;
  /** True when this source's publisher alias owns the event, so a re-import may update it. */
  sourceOwnsEvent(sourceId: string, eventId: string): Promise<boolean>;
  /** Live events within 200 m whose start is within 30 minutes. */
  duplicateCandidates(input: {
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
  updateImported(eventId: string, input: ImportedEventWrite): Promise<void>;
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
}
