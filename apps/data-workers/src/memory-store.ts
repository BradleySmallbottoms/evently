import { randomUUID } from 'node:crypto';
import { SEED_TAGS } from '@local-events/db';
import { slugifyPublisherName, tagSlug } from '@local-events/domain';
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
  /** Pre-map an organizer onto an existing publisher (for example a verified one). */
  linkPublisher(input: {
    sourceId: string;
    organizerKey: string;
    name: string;
    isTemporary: boolean;
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
      return { publisherId: publisher.id, isTemporary: publisher.isTemporary };
    },
    async createTemporaryPublisher(input) {
      const id = randomUUID();
      publishers.push({
        id,
        name: input.name,
        slug: uniqueSlug(input.name),
        isTemporary: true,
      });
      aliases.push({
        sourceId: input.sourceId,
        organizerKey: input.organizerKey,
        publisherId: id,
      });
      return { publisherId: id, isTemporary: true };
    },
    linkPublisher(input) {
      const id = randomUUID();
      publishers.push({
        id,
        name: input.name,
        slug: uniqueSlug(input.name),
        isTemporary: input.isTemporary,
      });
      aliases.push({
        sourceId: input.sourceId,
        organizerKey: input.organizerKey,
        publisherId: id,
      });
      return { publisherId: id, isTemporary: input.isTemporary };
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
          const suffix = incomingTag.externalId.replace(/[^a-z0-9]+/gi, '').slice(-8).toLowerCase();
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
    async findEventImage(eventId) {
      const image = images.find((item) => item.eventId === eventId);
      return image ? { sourceUrl: image.sourceUrl, s3Key: image.s3Key } : null;
    },
    async saveEventImage(input) {
      const image = images.find((item) => item.eventId === input.eventId);
      if (image) {
        image.s3Key = input.s3Key;
        image.sourceUrl = input.sourceUrl;
        image.contentType = input.contentType;
        return;
      }
      images.push({
        eventId: input.eventId,
        s3Key: input.s3Key,
        sourceUrl: input.sourceUrl,
        contentType: input.contentType,
      });
    },
  };
  return store;
}
