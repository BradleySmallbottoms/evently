import { randomUUID } from 'node:crypto';
import { SEED_TAGS } from '@local-events/db';
import { readEventMeta, type EventMeta } from '@local-events/contracts';
import { distanceMeters } from '@local-events/geo';
import {
  choosePublisher,
  DUPLICATE_RADIUS_M,
  importNotificationMessages,
  PUBLISHER_NAME_RADIUS_M,
  pushStatusForEvent,
  sharedOrganizerKeyKind,
  slugifyPublisherName,
  tagSlug,
  withinDuplicateWindow,
  type MarketingPushPlanId,
} from '@local-events/domain';
import type {
  EventRecord,
  ExternalRefHit,
  ImportedEventWrite,
  IngestStore,
  NearbyEventHit,
  NearbyPublisherHit,
  PendingScanRow,
  PublisherLink,
  PublisherRecord,
  ScanPublisherCandidate,
  SourceRecord,
} from './store';
import { NEARBY_RADIUS_M, NEARBY_RESULT_LIMIT, PUBLISHER_NAME_SEARCH_RADIUS_M, publisherNameMatcher } from './store';

type StoredTag = { id: string; slug: string; name: string; externalId: string };

interface StoredPublisher {
  id: string;
  name: string;
  slug: string;
  isTemporary: boolean;
  verified: boolean;
  importNotificationPlan: MarketingPushPlanId | null;
  createdAt: number;
}

interface StoredEvent {
  id: string;
  publisherId: string | null;
  createdAt?: Date;
  scanClaimedUntil?: Date | null;
  title: string;
  description: string | null;
  status: ExternalRefHit['status'];
  origin: 'native' | 'imported';
  sourceUrl: string;
  refId?: string | null;
  workerId?: string | null;
  startsAt: Date;
  endsAt: Date;
  venueName: string | null;
  location?: { lat: number; lng: number };
  tagIds: string[];
  onlineUrl?: string;
  priceAmount?: number;
  currency?: string;
  meta: EventMeta;
  summary?: string | null;
  language?: 'sv' | 'en';
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
  suppressions: { sourceId: string; externalId: string }[];
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
    createdAt: new Date(),
    scanClaimedUntil: null,
    title: input.event.title,
    description: input.event.description ?? null,
    status: input.status,
    origin: 'imported',
    sourceUrl: input.event.sourceUrl,
    refId: input.refId,
    workerId: input.workerId,
    startsAt: new Date(input.event.startsAt),
    endsAt: new Date(input.endsAt),
    venueName: input.event.venueName ?? null,
    location: input.event.location,
    tagIds: [...input.tagIds],
    onlineUrl: input.event.onlineUrl,
    priceAmount: input.event.priceAmount,
    currency: input.event.currency,
    meta: input.event.meta ?? {},
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
  const suppressions: MemoryIngestStore['suppressions'] = [];
  const runs: StoredRun[] = [];
  let createdAt = 0;
  const stamp = () => {
    createdAt += 1;
    return createdAt;
  };
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
    suppressions,
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
    async listPublisherCandidates(sourceId, organizerKeys, near) {
      void sourceId;
      if (organizerKeys.length === 0) return [];
      const localSlugs = near?.localSlugs ?? [];
      const nameKeys = organizerKeys.filter(
        (key) => sharedOrganizerKeyKind(key, localSlugs) === 'name',
      );
      const nearIds = new Set<string>();
      if (near?.location) {
        for (const event of events) {
          if (event.status === 'cancelled' || event.status === 'ended' || !event.location) continue;
          if (!event.publisherId) continue;
          if (distanceMeters(near.location, event.location) <= PUBLISHER_NAME_RADIUS_M) {
            nearIds.add(event.publisherId);
          }
        }
      }
      const candidates: ScanPublisherCandidate[] = [];
      for (const alias of aliases) {
        if (!organizerKeys.includes(alias.organizerKey)) continue;
        const publisher = publishers.find((item) => item.id === alias.publisherId);
        if (!publisher) continue;
        candidates.push({
          publisherId: publisher.id,
          sourceId: alias.sourceId,
          key: alias.organizerKey,
          verified: publisher.verified,
          createdAt: publisher.createdAt,
          near: nearIds.has(publisher.id),
          isTemporary: publisher.isTemporary,
          importNotificationPlan: publisher.importNotificationPlan,
          organizerKeys: aliases
            .filter((item) => item.publisherId === publisher.id)
            .map((item) => item.organizerKey),
          publisherName: publisher.name,
        });
      }
      for (const publisher of publishers) {
        const nameKey = nameKeys.find(
          (key) =>
            publisher.name.toLocaleLowerCase('sv') === key ||
            publisher.slug === key ||
            publisher.slug === slugifyPublisherName(key),
        );
        if (!nameKey) continue;
        candidates.push({
          publisherId: publisher.id,
          sourceId: null,
          key: nameKey,
          verified: publisher.verified,
          createdAt: publisher.createdAt,
          near: nearIds.has(publisher.id),
          isTemporary: publisher.isTemporary,
          importNotificationPlan: publisher.importNotificationPlan,
          organizerKeys: aliases
            .filter((item) => item.publisherId === publisher.id)
            .map((item) => item.organizerKey),
          publisherName: publisher.name,
        });
      }
      return candidates;
    },
    async findPublisher(sourceId, organizerKeys, near) {
      const localSlugs = near?.localSlugs ?? [];
      const candidates = await store.listPublisherCandidates(sourceId, organizerKeys, near);
      const chosen = choosePublisher(sourceId, organizerKeys, localSlugs, candidates);
      const publisher = publishers.find((item) => item.id === chosen?.publisherId);
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
        createdAt: stamp(),
      });
      for (const organizerKey of input.organizerKeys) {
        aliases.push({ sourceId: input.sourceId, organizerKey, publisherId: id });
      }
      return {
        publisherId: id,
        isTemporary: true,
        verified: false,
        importNotificationPlan: null,
      };
    },
    async rememberOrganizerKeys(sourceId, publisherId, organizerKeys) {
      for (const organizerKey of organizerKeys) {
        const taken = aliases.some(
          (item) => item.sourceId === sourceId && item.organizerKey === organizerKey,
        );
        if (taken) continue;
        aliases.push({ sourceId, organizerKey, publisherId });
      }
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
        createdAt: stamp(),
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
    async isImportSuppressed(sourceId, externalId) {
      return suppressions.some(
        (item) => item.sourceId === sourceId && item.externalId === externalId,
      );
    },
    async findExternalRef(sourceId, externalId) {
      const ref = refs.find((item) => item.sourceId === sourceId && item.externalId === externalId);
      if (!ref) return null;
      const event = events.find((item) => item.id === ref.eventId);
      if (!event) return null;
      return { eventId: event.id, contentHash: ref.contentHash, status: event.status };
    },
    async listDuplicateCandidates(input) {
      return events.flatMap((event) => {
        if (event.status === 'cancelled' || event.status === 'ended' || !event.location) return [];
        if (!withinDuplicateWindow(input.startsAt, event.startsAt)) return [];
        const distanceM = distanceMeters(input.location, event.location);
        if (distanceM > DUPLICATE_RADIUS_M) return [];
        const externalIds = refs
          .filter((ref) => ref.eventId === event.id)
          .map((ref) => ref.externalId);
        return [
          {
            eventId: event.id,
            title: event.title,
            startsAt: event.startsAt,
            location: event.location,
            sourceUrl: event.sourceUrl,
            links: (event.links ?? []).map((link) => link.url),
            refId: event.refId ?? null,
            workerId: event.workerId ?? null,
            externalIds,
            distanceM,
          },
        ];
      });
    },
    async listTags() {
      return [...tags.values()].map((tag) => ({
        externalId: tag.externalId,
        name: tag.name,
        slug: tag.slug,
      }));
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
      if (input.status === 'pending_scan' && event.status !== 'pending_scan') return false;
      const next = eventFromWrite(eventId, input);
      next.status = event.status;
      if (input.event.onlineUrl === undefined) next.onlineUrl = event.onlineUrl;
      if (input.event.priceAmount === undefined) next.priceAmount = event.priceAmount;
      if (input.event.currency === undefined) next.currency = event.currency;
      if (input.event.links === undefined) next.links = event.links;
      if (!next.meta.possibleDuplicate && event.meta.possibleDuplicate) {
        next.meta = { ...next.meta, possibleDuplicate: event.meta.possibleDuplicate };
      }
      const createdAt = event.createdAt ?? new Date();
      Object.assign(event, next);
      event.createdAt = createdAt;
      event.scanClaimedUntil = null;
      const ref = refs.find(
        (item) => item.sourceId === input.sourceId && item.externalId === input.externalId,
      );
      if (!ref) throw new Error(`Unknown external ref ${input.externalId}`);
      ref.contentHash = input.contentHash;
      ref.lastSeenAt = new Date();
      return true;
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
    async claimPendingScans(limit, leaseMs, eventId) {
      const now = Date.now();
      const until = new Date(now + leaseMs);
      const due = events
        .filter(
          (event) =>
            event.status === 'pending_scan' &&
            (event.scanClaimedUntil == null || event.scanClaimedUntil.getTime() < now) &&
            (eventId == null || event.id === eventId),
        )
        .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
        .slice(0, eventId ? 1 : limit);
      const rows: PendingScanRow[] = [];
      for (const event of due) {
        event.scanClaimedUntil = until;
        const ref = refs.find((item) => item.eventId === event.id);
        const source = ref ? sources.find((item) => item.id === ref.sourceId) : undefined;
        if (!ref || !source) {
          event.scanClaimedUntil = null;
          continue;
        }
        const meta = readEventMeta(event.meta);
        const tagById = new Map([...tags.values()].map((tag) => [tag.id, tag]));
        rows.push({
          eventId: event.id,
          title: event.title,
          description: event.description,
          venueName: event.venueName,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          location: event.location ?? null,
          sourceUrl: event.sourceUrl,
          links: (event.links ?? []).map((link) => link.url),
          externalId: ref.externalId,
          workerId: event.workerId ?? source.slug,
          tagIds: event.tagIds,
          tags: event.tagIds.flatMap((tagId) => {
            const tag = tagById.get(tagId);
            return tag ? [{ externalId: tag.externalId, name: tag.name }] : [];
          }),
          meta,
          sourceId: source.id,
          sourceSlug: source.slug,
          sourceTrust: source.trust,
          claimedUntil: until,
        });
      }
      return rows;
    },
    /**
     * Live events inside the scan radius and time window, nearest first.
     * The event being scanned is left out. Cancelled and ended rows are left out.
     */
    async nearbyEvents(point, window, excludeEventId) {
      const hits: NearbyEventHit[] = [];
      for (const event of events) {
        if (event.id === excludeEventId || !event.location) continue;
        if (event.status === 'cancelled' || event.status === 'ended') continue;
        const starts = event.startsAt.getTime();
        if (starts < window.from.getTime() || starts > window.to.getTime()) continue;
        const distanceM = Math.round(distanceMeters(point, event.location));
        if (distanceM > NEARBY_RADIUS_M) continue;
        hits.push({
          id: event.id,
          title: event.title,
          startsAt: event.startsAt.toISOString(),
          venue: event.venueName,
          distanceM,
        });
      }
      return hits.sort((a, b) => a.distanceM - b.distanceM).slice(0, NEARBY_RESULT_LIMIT);
    },
    /**
     * One row per publisher that has a live event in the same radius and window,
     * using that publisher's closest event.
     */
    async nearbyPublishers(point, window, excludeEventId) {
      const closest = new Map<string, NearbyPublisherHit>();
      for (const event of events) {
        if (!event.publisherId || event.id === excludeEventId || !event.location) continue;
        if (event.status === 'cancelled' || event.status === 'ended') continue;
        const starts = event.startsAt.getTime();
        if (starts < window.from.getTime() || starts > window.to.getTime()) continue;
        const publisher = publishers.find((item) => item.id === event.publisherId);
        if (!publisher) continue;
        const distanceM = Math.round(distanceMeters(point, event.location));
        if (distanceM > NEARBY_RADIUS_M) continue;
        const hit: NearbyPublisherHit = {
          id: publisher.id,
          name: publisher.name,
          verified: publisher.verified,
          temporary: publisher.isTemporary,
          nearestEventTitle: event.title,
          distanceM,
          organizerKeys: aliases
            .filter((alias) => alias.publisherId === publisher.id)
            .map((alias) => alias.organizerKey),
        };
        const current = closest.get(publisher.id);
        if (!current || hit.distanceM < current.distanceM) closest.set(publisher.id, hit);
      }
      return [...closest.values()].sort((a, b) => a.distanceM - b.distanceM).slice(0, NEARBY_RESULT_LIMIT);
    },
    /**
     * Publishers whose name matches `*` and `?` and that have a non-cancelled event
     * within 50 km. Each publisher is kept from its closest such event.
     */
    async publishersByName(point, name, excludeEventId) {
      const matcher = publisherNameMatcher(name);
      if ('error' in matcher) return [];
      const closest = new Map<string, NearbyPublisherHit>();
      for (const event of events) {
        if (!event.publisherId || event.id === excludeEventId || !event.location) continue;
        if (event.status === 'cancelled') continue;
        const publisher = publishers.find((item) => item.id === event.publisherId);
        if (!publisher || !matcher.matches(publisher.name)) continue;
        const distanceM = Math.round(distanceMeters(point, event.location));
        if (distanceM > PUBLISHER_NAME_SEARCH_RADIUS_M) continue;
        const hit: NearbyPublisherHit = {
          id: publisher.id,
          name: publisher.name,
          verified: publisher.verified,
          temporary: publisher.isTemporary,
          nearestEventTitle: event.title,
          distanceM,
          organizerKeys: aliases
            .filter((alias) => alias.publisherId === publisher.id)
            .map((alias) => alias.organizerKey),
        };
        const current = closest.get(publisher.id);
        if (!current || hit.distanceM < current.distanceM) closest.set(publisher.id, hit);
      }
      return [...closest.values()].sort((a, b) => a.distanceM - b.distanceM).slice(0, NEARBY_RESULT_LIMIT);
    },
    /** Publisher row plus the organizer keys stored as aliases. */
    async getPublisher(publisherId): Promise<PublisherRecord | null> {
      const publisher = publishers.find((item) => item.id === publisherId);
      if (!publisher) return null;
      return {
        id: publisher.id,
        verified: publisher.verified,
        createdAt: publisher.createdAt,
        isTemporary: publisher.isTemporary,
        importNotificationPlan: publisher.importNotificationPlan,
        organizerKeys: aliases
          .filter((alias) => alias.publisherId === publisher.id)
          .map((alias) => alias.organizerKey),
      };
    },
    /** Occasion ids already stored on these events. Missing ids are left out. */
    async listOccasionGroups(eventIds) {
      const wanted = new Set(eventIds);
      return events.flatMap((event) => {
        if (!wanted.has(event.id)) return [];
        return [
          {
            eventId: event.id,
            ...(event.meta.occasionGroupId ? { occasionGroupId: event.meta.occasionGroupId } : {}),
            ...(event.meta.possibleOccasionGroupId
              ? { possibleOccasionGroupId: event.meta.possibleOccasionGroupId }
              : {}),
          },
        ];
      });
    },
    /** Sets the scan occasion group and leaves every other meta key as it is. */
    async setPossibleOccasionGroup(eventIds, groupId) {
      const wanted = new Set(eventIds);
      for (const event of events) {
        if (!wanted.has(event.id)) continue;
        event.meta = { ...event.meta, possibleOccasionGroupId: groupId };
      }
    },
    /** The stored event fields the scan compares when the model names a duplicate. */
    async getEvent(eventId): Promise<EventRecord | null> {
      const event = events.find((item) => item.id === eventId);
      if (!event) return null;
      return {
        eventId: event.id,
        title: event.title,
        startsAt: event.startsAt.toISOString(),
        refId: event.refId ?? null,
        workerId: event.workerId ?? null,
      };
    },
    async releaseScanClaim(eventId, claimedUntil) {
      const event = events.find((item) => item.id === eventId);
      if (!event || event.status !== 'pending_scan') return;
      if (event.scanClaimedUntil?.getTime() !== claimedUntil.getTime()) return;
      event.scanClaimedUntil = null;
    },
    async finishImportedScan(input) {
      const event = events.find((item) => item.id === input.eventId);
      if (!event || event.status !== 'pending_scan') return false;
      if (event.scanClaimedUntil?.getTime() !== input.claimedUntil.getTime()) return false;
      event.publisherId = input.publisherId;
      event.status = input.status;
      event.meta = input.meta;
      event.tagIds = input.tagIds;
      event.summary = input.summary;
      event.language = input.language;
      event.scanClaimedUntil = null;
      return true;
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
