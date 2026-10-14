import { randomUUID } from 'node:crypto';
import { SEED_TAGS } from '@local-events/db';
import {
  importNotificationMessages,
  pushStatusForEvent,
  slugifyPublisherName,
  tagSlug,
  type MarketingPushPlanId,
} from '@local-events/domain';
import type {
  ExternalRefHit,
  ImportedEventWrite,
  IngestStore,
  NearbyEvent,
  PublisherLink,
  SourceRecord,
} from './store';

type StoredTag = { id: string; slug: string; name: string; externalId: string };

const NEAR_MS = 30 * 60 * 1000;

interface StoredPublisher {
  id: string;
  name: string;
  slug: string;
  isTemporary: boolean;
  verified: boolean;
  importNotificationPlan: MarketingPushPlanId | null;
}

interface StoredEvent {
  id: string;
  publisherId: string;
  title: string;
  description: string | null;
  status: ExternalRefHit['status'];
  origin: 'native' | 'imported';
  sourceUrl: string;
  startsAt: Date;
  endsAt: Date;
  venueName: string | null;
  location?: { lat: number; lng: number };
  tagIds: string[];
  onlineUrl?: string;
  priceAmount?: number;
  currency?: string;
  links?: { type: 'tickets' | 'registration' | 'info'; url: string; label?: string }[];
}

interface StoredRef {
  sourceId: string;
  externalId: string;
  eventId: string;
  contentHash: string;
  lastSeenAt: Date;
}

interface StoredRun {
  id: string;
  sourceId: string;
  status: string;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  error: string | null;
}

interface StoredImage {
  eventId: string;
  role: string;
  s3Key: string;
  sourceUrl: string | null;
  contentType: string;
}

export interface MemoryIngestStore extends IngestStore {
  sources: SourceRecord[];
  publishers: StoredPublisher[];
  events: StoredEvent[];
  refs: StoredRef[];
  runs: StoredRun[];
  images: StoredImage[];
  scheduledNotifications: {
    eventId: string;
    planId: string;
    offsets: string[];
    status: 'pending' | 'approved';
  }[];
  /** Pre-map an organizer onto an existing publisher (for example a verified one). */
  linkPublisher(input: {
    sourceId: string;
    organizerKey: string;
    name: string;
    isTemporary: boolean;
    verified?: boolean;
    importNotificationPlan?: MarketingPushPlanId | null;
  }): PublisherLink;
}

function eventFromWrite(id: string, input: ImportedEventWrite): StoredEvent {
  return {
    id,
    publisherId: input.publisherId,
    title: input.event.title,
    description: input.event.description ?? null,
    status: input.status,
    origin: 'imported',
    sourceUrl: input.event.sourceUrl,
    startsAt: new Date(input.event.startsAt),
    endsAt: new Date(input.endsAt),
    venueName: input.event.venueName ?? null,
    location: input.event.location,
    tagIds: [...input.tagIds],
    onlineUrl: input.event.onlineUrl,
    priceAmount: input.event.priceAmount,
    currency: input.event.currency,
    links: input.event.links?.map((link) => ({ ...link })),
  };
}

export function createMemoryIngestStore(): MemoryIngestStore {
  const tags = new Map<string, StoredTag>(SEED_TAGS.map((tag) => [tag.externalId, { ...tag }]));
  const sources: SourceRecord[] = [];
  const publishers: StoredPublisher[] = [];
  const aliases: { sourceId: string; organizerKey: string; publisherId: string }[] = [];
  const events: StoredEvent[] = [];
  const refs: StoredRef[] = [];
  const runs: StoredRun[] = [];
  const images: StoredImage[] = [];
  const scheduledNotifications: MemoryIngestStore['scheduledNotifications'] = [];

  function uniqueSlug(name: string): string {
    const base = slugifyPublisherName(name);
    let slug = base;
    let n = 2;
    while (publishers.some((publisher) => publisher.slug === slug)) {
      slug = `${base}-${n++}`.slice(0, 64);
    }
    return slug;
  }

  const store: MemoryIngestStore = {
    sources,
    publishers,
    events,
    refs,
    runs,
    images,
    scheduledNotifications,
    async getSource(slug) {
      return sources.find((source) => source.slug === slug) ?? null;
    },
    async startRun(sourceId) {
      const id = randomUUID();
      runs.push({
        id,
        sourceId,
        status: 'running',
        fetched: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        error: null,
      });
      return id;
    },
    async finishRun(runId, result) {
      const run = runs.find((item) => item.id === runId);
      if (!run) throw new Error(`Unknown ingestion run ${runId}`);
      Object.assign(run, result);
    },
    async findPublisher(sourceId, organizerKey) {
      const alias = aliases.find(
        (item) => item.sourceId === sourceId && item.organizerKey === organizerKey,
      );
      if (!alias) return null;
      const publisher = publishers.find((item) => item.id === alias.publisherId);
      if (!publisher) return null;
      return {
        publisherId: publisher.id,
        isTemporary: publisher.isTemporary,
        verified: publisher.verified,
        importNotificationPlan: publisher.importNotificationPlan,
      };
    },
    async createTemporaryPublisher(input) {
      const id = randomUUID();
      publishers.push({
        id,
        name: input.name,
        slug: uniqueSlug(input.name),
        isTemporary: true,
        verified: false,
        importNotificationPlan: null,
      });
      aliases.push({
        sourceId: input.sourceId,
        organizerKey: input.organizerKey,
        publisherId: id,
      });
      return {
        publisherId: id,
        isTemporary: true,
        verified: false,
        importNotificationPlan: null,
      };
    },
    linkPublisher(input) {
      const id = randomUUID();
      const verified = input.verified ?? false;
      const importNotificationPlan = input.importNotificationPlan ?? null;
      publishers.push({
        id,
        name: input.name,
        slug: uniqueSlug(input.name),
        isTemporary: input.isTemporary,
        verified,
        importNotificationPlan,
      });
      aliases.push({
        sourceId: input.sourceId,
        organizerKey: input.organizerKey,
        publisherId: id,
      });
      return { publisherId: id, isTemporary: input.isTemporary, verified, importNotificationPlan };
    },
    async scheduleImportNotifications(input) {
      if (scheduledNotifications.some((row) => row.eventId === input.eventId)) return;
      const messages = importNotificationMessages({
        planId: input.planId,
        eventTitle: input.eventTitle,
        startsAt: input.startsAt,
        now: new Date(),
      });
      if (messages.length === 0) return;
      scheduledNotifications.push({
        eventId: input.eventId,
        planId: input.planId,
        offsets: messages.map((message) => message.offset),
        status: pushStatusForEvent(input.status),
      });
    },
    async sourceOwnsEvent(sourceId, eventId) {
      const event = events.find((item) => item.id === eventId);
      if (!event) return false;
      return aliases.some(
        (alias) => alias.sourceId === sourceId && alias.publisherId === event.publisherId,
      );
    },
    async findExternalRef(sourceId, externalId) {
      const ref = refs.find((item) => item.sourceId === sourceId && item.externalId === externalId);
      if (!ref) return null;
      const event = events.find((item) => item.id === ref.eventId);
      if (!event) return null;
      return { eventId: event.id, contentHash: ref.contentHash, status: event.status };
    },
    async candidatesNear(startsAt) {
      return events
        .filter((event) => Math.abs(event.startsAt.getTime() - startsAt.getTime()) <= NEAR_MS)
        .map((event): NearbyEvent => ({
          eventId: event.id,
          title: event.title,
          startsAt: event.startsAt,
          location: event.location,
        }));
    },
    async listTags() {
      return [...tags.values()].map((tag) => ({ externalId: tag.externalId, name: tag.name }));
    },
    async listEventTags(sourceId) {
      const byId = new Map([...tags.values()].map((tag) => [tag.id, tag]));
      const rows: { externalId: string; tag: { externalId: string; name: string } }[] = [];
      for (const ref of refs) {
        if (ref.sourceId !== sourceId) continue;
        const event = events.find((item) => item.id === ref.eventId);
        if (!event) continue;
        for (const tagId of event.tagIds) {
          const tag = byId.get(tagId);
          if (!tag) continue;
          rows.push({
            externalId: ref.externalId,
            tag: { externalId: tag.externalId, name: tag.name },
          });
        }
      }
      return rows;
    },
    async upsertTags(incoming) {
      const slugs = new Set([...tags.values()].map((tag) => tag.slug));
      for (const incomingTag of incoming) {
        const existing = tags.get(incomingTag.externalId);
        if (existing) {
          existing.name = incomingTag.name;
          continue;
        }
        let slug = tagSlug(incomingTag.name);
        if (slugs.has(slug)) {
          const suffix = incomingTag.externalId
            .replace(/[^a-z0-9]+/gi, '')
            .slice(-8)
            .toLowerCase();
          slug = `${slug}-${suffix}`.slice(0, 80);
        }
        slugs.add(slug);
        tags.set(incomingTag.externalId, {
          id: randomUUID(),
          slug,
          name: incomingTag.name,
          externalId: incomingTag.externalId,
        });
      }
    },
    async tagIdsForExternalIds(externalIds) {
      return externalIds.flatMap((externalId) => {
        const tag = tags.get(externalId);
        return tag ? [tag.id] : [];
      });
    },
    async insertImported(input) {
      const id = randomUUID();
      events.push(eventFromWrite(id, input));
      refs.push({
        sourceId: input.sourceId,
        externalId: input.externalId,
        eventId: id,
        contentHash: input.contentHash,
        lastSeenAt: new Date(),
      });
      return id;
    },
    async updateImported(eventId, input) {
      const event = events.find((item) => item.id === eventId);
      if (!event) throw new Error(`Unknown event ${eventId}`);
      const next = eventFromWrite(eventId, input);
      next.status = event.status;
      if (input.event.onlineUrl === undefined) next.onlineUrl = event.onlineUrl;
      if (input.event.priceAmount === undefined) next.priceAmount = event.priceAmount;
      if (input.event.currency === undefined) next.currency = event.currency;
      if (input.event.links === undefined) next.links = event.links;
      Object.assign(event, next);
      const ref = refs.find(
        (item) => item.sourceId === input.sourceId && item.externalId === input.externalId,
      );
      if (!ref) throw new Error(`Unknown external ref ${input.externalId}`);
      ref.contentHash = input.contentHash;
      ref.lastSeenAt = new Date();
    },
    async linkExisting(input) {
      refs.push({ ...input, lastSeenAt: new Date() });
    },
    async touchRef(sourceId, externalId) {
      const ref = refs.find((item) => item.sourceId === sourceId && item.externalId === externalId);
      if (!ref) throw new Error(`Unknown external ref ${externalId}`);
      ref.lastSeenAt = new Date();
    },
    async noteRef(sourceId, externalId, contentHash) {
      const ref = refs.find((item) => item.sourceId === sourceId && item.externalId === externalId);
      if (!ref) throw new Error(`Unknown external ref ${externalId}`);
      ref.contentHash = contentHash;
      ref.lastSeenAt = new Date();
    },
    async findEventImage(eventId, role = 'main') {
      const image = images.find((item) => item.eventId === eventId && item.role === role);
      return image ? { sourceUrl: image.sourceUrl, s3Key: image.s3Key } : null;
    },
    async listEventImages(eventId) {
      return images
        .filter((item) => item.eventId === eventId)
        .map((item) => ({ role: item.role, sourceUrl: item.sourceUrl, s3Key: item.s3Key }));
    },
    async saveEventImage(input) {
      const role = input.role ?? 'main';
      const image = images.find((item) => item.eventId === input.eventId && item.role === role);
      if (image) {
        image.s3Key = input.s3Key;
        image.sourceUrl = input.sourceUrl;
        image.contentType = input.contentType;
        return;
      }
      images.push({
        eventId: input.eventId,
        role,
        s3Key: input.s3Key,
        sourceUrl: input.sourceUrl,
        contentType: input.contentType,
      });
    },
    async deleteEventImages(eventId, roles) {
      const drop = new Set(roles.filter((role) => role.startsWith('gallery-')));
      if (drop.size === 0) return;
      for (let index = images.length - 1; index >= 0; index -= 1) {
        const image = images[index];
        if (image && image.eventId === eventId && drop.has(image.role)) images.splice(index, 1);
      }
    },
  };
  return store;
}
