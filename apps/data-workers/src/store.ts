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

export interface NearbyEvent {
  eventId: string;
  title: string;
  startsAt: Date;
  location?: { lat: number; lng: number };
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
  findPublisher(sourceId: string, organizerKey: string): Promise<PublisherLink | null>;
  createTemporaryPublisher(input: {
    sourceId: string;
    organizerKey: string;
    name: string;
  }): Promise<PublisherLink>;
  findExternalRef(sourceId: string, externalId: string): Promise<ExternalRefHit | null>;
  /** True when this source's publisher alias owns the event, so a re-import may update it. */
  sourceOwnsEvent(sourceId: string, eventId: string): Promise<boolean>;
  candidatesNear(startsAt: Date): Promise<NearbyEvent[]>;
  upsertTags(tags: { externalId: string; name: string }[]): Promise<void>;
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
  linkExisting(input: {
    sourceId: string;
    externalId: string;
    eventId: string;
    contentHash: string;
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
