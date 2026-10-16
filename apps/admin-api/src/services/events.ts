import { randomUUID } from 'node:crypto';

function publisherIdOf(id: string | null): string {
  if (!id) throw new Error('event has no publisher');
  return id;
}
import {
  type AdminEventDecisionResponse,
  type AdminEventDeleteResponse,
  type AdminEventDetail,
  type AdminEventListQuery,
  type AdminEventListResponse,
  type AdminEventPatchRequest,
  type AdminEventReviewListResponse,
  type ContentVerdict,
  type Tag,
  type EventLink,
  readEventMeta,
} from '@local-events/contracts';
import type { Db } from '@local-events/db';
import {
  approvePendingPushMessagesForEvent,
  cancelOpenPushMessages,
  pointEwkt,
  schema,
} from '@local-events/db';
import {
  canApproveImportedEvent,
  canDeleteImportedEvent,
  canRejectImportedEvent,
  publicAssetUrl,
  publicGalleryUrls,
  shouldEnqueueNotifications,
  importPlanToSchedule,
  reviewWarnings,
  validateEventFields,
} from '@local-events/domain';
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { AdminAuditServices } from './audit';
import { noopAudit } from './audit';
import { createMemoryDomainEventPublisher } from './domain-events/memory';
import { scheduleImportPlanForEvent } from './import-notifications';
import { upsertEventPushDraft } from './push-drafts/drafts';
import { enqueueDomainEvent, type DomainEventPublisher } from './domain-events/types';

export class AdminEventError extends Error {
  readonly code: 'invalid_event' | 'online_url_required';

  constructor(code: 'invalid_event' | 'online_url_required') {
    super(code);
    this.name = 'AdminEventError';
    this.code = code;
  }
}

export type AdminEventServices = {
  listInReview: () => Promise<AdminEventReviewListResponse['items']>;
  list: (query: AdminEventListQuery) => Promise<AdminEventListResponse>;
  listTags: () => Promise<Tag[]>;
  get: (eventId: string) => Promise<AdminEventDetail | null>;
  approve: (eventId: string, actor: string) => Promise<AdminEventDecisionResponse | null>;
  reject: (eventId: string, actor: string) => Promise<AdminEventDecisionResponse | null>;
  /** Cancel an in-review import and leave the row, even when people have checked in. */
  softDelete: (eventId: string, actor: string) => Promise<AdminEventDecisionResponse | null>;
  /** Remove an in-review import. Refuses when anyone has checked in, saved, rated, or been notified. */
  wipe: (eventId: string, actor: string) => Promise<AdminEventDeleteResponse | null>;
  patch: (
    eventId: string,
    body: AdminEventPatchRequest,
    actor: string,
  ) => Promise<AdminEventDetail | null>;
};

export type AdminEventEnv = {
  now?: () => Date;
  domainEvents?: DomainEventPublisher;
  audit?: AdminAuditServices;
  /** Garage or CloudFront origin. Image URLs are omitted when this is unset. */
  assetsPublicBaseUrl?: string;
};

type MemoryEventLink = {
  id: string;
  type: EventLink['type'];
  url: string;
  label: string | null;
  position: number;
};

type MemoryEvent = {
  id: string;
  publisherId: string;
  title: string;
  description?: string | null;
  mode: 'physical' | 'digital';
  status: string;
  origin: 'native' | 'imported';
  startsAt: string;
  endsAt: string;
  timezone?: string;
  venueName: string | null;
  location?: { lat: number; lng: number } | null;
  geofenceRadiusM?: number | null;
  onlineUrl?: string | null;
  priceAmount?: number | null;
  currency?: string;
  meta?: AdminEventDetail['meta'];
  sourceUrl: string | null;
  contentVerdict?: ContentVerdict;
  llmOutput?: unknown;
  refId?: string | null;
  workerId?: string | null;
  tagIds?: string[];
  links?: MemoryEventLink[];
  featured?: boolean;
  checkInEnabled?: boolean;
  images?: { role: string; s3Key: string }[];
  createdAt: string;
  updatedAt: string;
};

export type AdminEventMemoryStore = {
  publishers: Map<string, { id: string; name: string }>;
  tags?: Map<string, Tag>;
  events: Map<string, MemoryEvent>;
};

const CONTENT_TOUCHES = [
  'title',
  'description',
  'mode',
  'startsAt',
  'endsAt',
  'timezone',
  'venueName',
  'location',
  'geofenceRadiusM',
  'onlineUrl',
  'priceAmount',
  'currency',
  'links',
  'tagIds',
] as const;

function touchesContent(body: AdminEventPatchRequest): boolean {
  return CONTENT_TOUCHES.some((key) => body[key] !== undefined);
}

function assertEditable(
  existing: {
    status: string;
    startsAt: string;
    endsAt: string;
    mode: 'physical' | 'digital';
    location?: { lat: number; lng: number } | null;
    onlineUrl?: string | null;
  },
  body: AdminEventPatchRequest,
): void {
  const nextStatus = body.status ?? existing.status;
  const publishing = nextStatus === 'published' && existing.status !== 'published';
  if (!touchesContent(body) && !publishing) return;
  const startsAt = body.startsAt ?? existing.startsAt;
  const endsAt = body.endsAt ?? existing.endsAt;
  if (new Date(endsAt) <= new Date(startsAt)) throw new AdminEventError('invalid_event');
  const check = validateEventFields({
    mode: body.mode ?? existing.mode,
    location: body.location !== undefined ? body.location : (existing.location ?? null),
    onlineUrl: body.onlineUrl !== undefined ? body.onlineUrl : (existing.onlineUrl ?? null),
  });
  if (!check.ok) throw new AdminEventError(check.reason);
}

function contentChanges(
  existing: {
    title: string;
    description?: string | null;
    mode: string;
    startsAt: string;
    endsAt: string;
    timezone?: string;
    venueName: string | null;
    location?: { lat: number; lng: number } | null;
    geofenceRadiusM?: number | null;
    onlineUrl?: string | null;
    priceAmount?: number | null;
    currency?: string;
    tagIds?: string[];
    links?: { type: string; url: string; label: string | null }[];
    featured?: boolean;
    checkInEnabled?: boolean;
  },
  body: AdminEventPatchRequest,
): string[] {
  const changed: string[] = [];
  const note = (field: string, differs: boolean) => {
    if (differs) changed.push(field);
  };
  if (body.title !== undefined) note('title', body.title !== existing.title);
  if (body.description !== undefined) {
    note('description', body.description !== (existing.description ?? null));
  }
  if (body.mode !== undefined) note('mode', body.mode !== existing.mode);
  if (body.startsAt !== undefined) note('startsAt', body.startsAt !== existing.startsAt);
  if (body.endsAt !== undefined) note('endsAt', body.endsAt !== existing.endsAt);
  if (body.timezone !== undefined)
    note('timezone', body.timezone !== (existing.timezone ?? 'Europe/Stockholm'));
  if (body.venueName !== undefined) note('venueName', body.venueName !== existing.venueName);
  if (body.location !== undefined) {
    note('location', JSON.stringify(body.location) !== JSON.stringify(existing.location ?? null));
  }
  if (body.geofenceRadiusM !== undefined) {
    note('geofenceRadiusM', body.geofenceRadiusM !== (existing.geofenceRadiusM ?? null));
  }
  if (body.onlineUrl !== undefined)
    note('onlineUrl', body.onlineUrl !== (existing.onlineUrl ?? null));
  if (body.priceAmount !== undefined) {
    note('priceAmount', body.priceAmount !== (existing.priceAmount ?? null));
  }
  if (body.currency !== undefined) note('currency', body.currency !== (existing.currency ?? 'SEK'));
  if (body.tagIds !== undefined) {
    note('tagIds', JSON.stringify(body.tagIds) !== JSON.stringify(existing.tagIds ?? []));
  }
  if (body.links !== undefined) {
    const prev = (existing.links ?? []).map((link) => ({
      type: link.type,
      url: link.url,
      label: link.label,
    }));
    const next = body.links.map((link) => ({
      type: link.type,
      url: link.url,
      label: link.label ?? null,
    }));
    note('links', JSON.stringify(prev) !== JSON.stringify(next));
  }
  if (body.featured !== undefined) note('featured', body.featured !== (existing.featured ?? false));
  if (body.checkInEnabled !== undefined) {
    note('checkInEnabled', body.checkInEnabled !== (existing.checkInEnabled ?? false));
  }
  return changed;
}

function auditSnapshot(detail: AdminEventDetail): Record<string, unknown> {
  return {
    title: detail.title,
    description: detail.description,
    mode: detail.mode,
    status: detail.status,
    startsAt: detail.startsAt,
    endsAt: detail.endsAt,
    timezone: detail.timezone,
    venueName: detail.venueName,
    location: detail.location,
    geofenceRadiusM: detail.geofenceRadiusM,
    onlineUrl: detail.onlineUrl,
    priceAmount: detail.priceAmount,
    currency: detail.currency,
    tagIds: detail.tagIds,
    featured: detail.featured,
    checkInEnabled: detail.checkInEnabled,
    links: detail.links.map((link) => ({
      type: link.type,
      url: link.url,
      label: link.label,
    })),
  };
}

function warningsFor(meta: unknown) {
  return reviewWarnings(readEventMeta(meta));
}

function contentVerdictOf(value: string | null | undefined): ContentVerdict {
  if (value === 'safe' || value === 'harmful' || value === 'spam' || value === 'unknown') {
    return value;
  }
  return 'unknown';
}

function asListItem(
  e: MemoryEvent,
  publisherName: string,
): AdminEventListResponse['items'][number] {
  return {
    id: e.id,
    publisherId: e.publisherId,
    publisherName,
    title: e.title,
    mode: e.mode,
    status: e.status as AdminEventListResponse['items'][number]['status'],
    origin: e.origin,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    venueName: e.venueName,
    sourceUrl: e.sourceUrl,
    featured: e.featured ?? false,
    checkInEnabled: e.checkInEnabled ?? false,
    contentVerdict: contentVerdictOf(e.contentVerdict),
    warnings: warningsFor(e.meta),
    createdAt: e.createdAt,
  };
}

function compareListed(a: MemoryEvent, b: MemoryEvent, sort: AdminEventListQuery['sort']): number {
  if (sort === 'created') {
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  }
  return b.startsAt.localeCompare(a.startsAt) || b.id.localeCompare(a.id);
}

function imageFields(
  images: readonly { role: string; s3Key: string }[],
  assetsPublicBaseUrl: string | undefined,
): Pick<AdminEventDetail, 'imageUrl' | 'imageUrls'> {
  const main = images.find((image) => image.role === 'main')?.s3Key ?? null;
  return {
    imageUrl: publicAssetUrl(assetsPublicBaseUrl, main),
    imageUrls: publicGalleryUrls(assetsPublicBaseUrl, images),
  };
}

function asDetail(
  e: MemoryEvent,
  publisherName: string,
  assetsPublicBaseUrl?: string,
): AdminEventDetail {
  return {
    ...asListItem(e, publisherName),
    description: e.description ?? null,
    timezone: e.timezone ?? 'Europe/Stockholm',
    location: e.location ?? null,
    geofenceRadiusM: e.geofenceRadiusM ?? null,
    onlineUrl: e.onlineUrl ?? null,
    priceAmount: e.priceAmount ?? null,
    currency: e.currency ?? 'SEK',
    meta: readEventMeta(e.meta),
    sourceUrl: e.sourceUrl,
    refId: e.refId ?? null,
    workerId: e.workerId ?? null,
    tagIds: e.tagIds ?? [],
    links: e.links ?? [],
    ...imageFields(e.images ?? [], assetsPublicBaseUrl),
    llmOutput: e.llmOutput ?? null,
    updatedAt: e.updatedAt,
  };
}

function applyMemoryPatch(row: MemoryEvent, body: AdminEventPatchRequest): void {
  if (body.title !== undefined) row.title = body.title;
  if (body.description !== undefined) row.description = body.description;
  if (body.mode !== undefined) row.mode = body.mode;
  if (body.status !== undefined) row.status = body.status;
  if (body.startsAt !== undefined) row.startsAt = body.startsAt;
  if (body.endsAt !== undefined) row.endsAt = body.endsAt;
  if (body.timezone !== undefined) row.timezone = body.timezone;
  if (body.venueName !== undefined) row.venueName = body.venueName;
  if (body.location !== undefined) row.location = body.location;
  if (body.geofenceRadiusM !== undefined) row.geofenceRadiusM = body.geofenceRadiusM;
  if (body.onlineUrl !== undefined) row.onlineUrl = body.onlineUrl;
  if (body.priceAmount !== undefined) row.priceAmount = body.priceAmount;
  if (body.currency !== undefined) row.currency = body.currency;
  if (body.tagIds !== undefined) row.tagIds = [...body.tagIds];
  if (body.featured !== undefined) row.featured = body.featured;
  if (body.checkInEnabled !== undefined) row.checkInEnabled = body.checkInEnabled;
  if (body.links !== undefined) {
    row.links = body.links.map((link, position) => ({
      id: randomUUID(),
      type: link.type,
      url: link.url,
      label: link.label ?? null,
      position,
    }));
  }
}

export function createMemoryAdminEventServices(
  store: AdminEventMemoryStore,
  env: AdminEventEnv = {},
): AdminEventServices {
  const now = env.now ?? (() => new Date());
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();
  const audit = env.audit ?? noopAudit;
  return {
    async listInReview() {
      return [...store.events.values()]
        .filter((e) => e.status === 'in_review')
        .sort((a, b) => compareListed(a, b, 'created'))
        .map((e) => ({
          id: e.id,
          publisherId: e.publisherId,
          publisherName: store.publishers.get(e.publisherId)?.name ?? 'Unknown',
          title: e.title,
          mode: e.mode,
          status: 'in_review' as const,
          origin: e.origin,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          venueName: e.venueName,
          sourceUrl: e.sourceUrl,
          contentVerdict: contentVerdictOf(e.contentVerdict),
          warnings: warningsFor(e.meta),
          createdAt: e.createdAt,
        }));
    },
    async list(query) {
      const needle = query.q?.toLocaleLowerCase();
      const matched = [...store.events.values()]
        .filter((e) => {
          if (query.status && e.status !== query.status) return false;
          if (!needle) return true;
          const publisherName = store.publishers.get(e.publisherId)?.name ?? 'Unknown';
          return (
            e.title.toLocaleLowerCase().includes(needle) ||
            (e.venueName?.toLocaleLowerCase().includes(needle) ?? false) ||
            publisherName.toLocaleLowerCase().includes(needle)
          );
        })
        .sort((a, b) => compareListed(a, b, query.sort));
      const items = matched
        .slice(query.offset, query.offset + query.limit)
        .map((e) => asListItem(e, store.publishers.get(e.publisherId)?.name ?? 'Unknown'));
      const next = query.offset + items.length;
      return {
        items,
        total: matched.length,
        nextOffset: next < matched.length ? next : null,
      };
    },
    async listTags() {
      return [...(store.tags?.values() ?? [])];
    },
    async get(eventId) {
      const row = store.events.get(eventId);
      if (!row) return null;
      return asDetail(
        row,
        store.publishers.get(row.publisherId)?.name ?? 'Unknown',
        env.assetsPublicBaseUrl,
      );
    },
    async approve(eventId, actor) {
      const row = store.events.get(eventId);
      if (!row || !canApproveImportedEvent(row.status)) return null;
      const before = { status: row.status };
      row.status = 'published';
      row.updatedAt = now().toISOString();
      if (shouldEnqueueNotifications('published')) {
        await enqueueDomainEvent(domainEvents, { type: 'event.published', eventId: row.id });
      }
      await audit.write({
        actor,
        action: 'event.approve',
        entityType: 'event',
        entityId: eventId,
        before,
        after: { status: 'published' },
      });
      return { id: row.id, status: 'published' as const };
    },
    async reject(eventId, actor) {
      const row = store.events.get(eventId);
      if (!row || !canRejectImportedEvent(row.status)) return null;
      const before = { status: row.status };
      row.status = 'cancelled';
      row.updatedAt = now().toISOString();
      await audit.write({
        actor,
        action: 'event.reject',
        entityType: 'event',
        entityId: eventId,
        before,
        after: { status: 'cancelled' },
      });
      return { id: row.id, status: 'cancelled' as const };
    },
    async softDelete(eventId, actor) {
      const row = store.events.get(eventId);
      if (!row || !canDeleteImportedEvent(row)) return null;
      const before = { status: row.status };
      row.status = 'cancelled';
      row.updatedAt = now().toISOString();
      await audit.write({
        actor,
        action: 'event.delete',
        entityType: 'event',
        entityId: eventId,
        before,
        after: { status: 'cancelled' },
      });
      return { id: row.id, status: 'cancelled' as const };
    },
    async wipe(eventId, actor) {
      const row = store.events.get(eventId);
      if (!row || !canDeleteImportedEvent(row)) return null;
      const before = { status: row.status, title: row.title };
      store.events.delete(eventId);
      await audit.write({
        actor,
        action: 'event.wipe',
        entityType: 'event',
        entityId: eventId,
        before,
        after: null,
      });
      return { id: eventId };
    },
    async patch(eventId, body, actor) {
      const row = store.events.get(eventId);
      if (!row) return null;
      if (body.tagIds && store.tags) {
        for (const tagId of body.tagIds) {
          if (!store.tags.has(tagId)) throw new AdminEventError('invalid_event');
        }
      }
      assertEditable(row, body);
      const publisherName = store.publishers.get(row.publisherId)?.name ?? 'Unknown';
      const before = asDetail(row, publisherName, env.assetsPublicBaseUrl);
      const changed = contentChanges(row, body);
      const previousStatus = row.status;
      applyMemoryPatch(row, body);
      row.updatedAt = now().toISOString();
      const nextStatus = row.status;
      if (nextStatus === 'published' && previousStatus !== 'published') {
        await enqueueDomainEvent(domainEvents, { type: 'event.published', eventId: row.id });
      } else if (
        previousStatus === 'published' &&
        nextStatus === 'published' &&
        changed.length > 0
      ) {
        await enqueueDomainEvent(domainEvents, {
          type: 'event.updated',
          eventId: row.id,
          changedFields: changed,
        });
      }
      const after = asDetail(row, publisherName, env.assetsPublicBaseUrl);
      await audit.write({
        actor,
        action: 'event.patch',
        entityType: 'event',
        entityId: eventId,
        before: auditSnapshot(before),
        after: auditSnapshot(after),
      });
      return after;
    },
  };
}

export function createDbAdminEventServices(db: Db, env: AdminEventEnv = {}): AdminEventServices {
  const now = env.now ?? (() => new Date());
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();
  const audit = env.audit ?? noopAudit;

  async function tagIdsFor(eventId: string): Promise<string[]> {
    const rows = await db
      .select({ tagId: schema.eventTags.tagId })
      .from(schema.eventTags)
      .where(eq(schema.eventTags.eventId, eventId));
    return rows.map((row) => row.tagId);
  }

  async function imagesFor(
    eventId: string,
  ): Promise<Pick<AdminEventDetail, 'imageUrl' | 'imageUrls'>> {
    const rows = await db
      .select({ role: schema.eventImages.role, s3Key: schema.eventImages.s3Key })
      .from(schema.eventImages)
      .where(eq(schema.eventImages.eventId, eventId));
    return imageFields(rows, env.assetsPublicBaseUrl);
  }

  async function linksFor(eventId: string): Promise<EventLink[]> {
    const rows = await db
      .select({
        id: schema.eventLinks.id,
        type: schema.eventLinks.type,
        url: schema.eventLinks.url,
        label: schema.eventLinks.label,
        position: schema.eventLinks.position,
      })
      .from(schema.eventLinks)
      .where(eq(schema.eventLinks.eventId, eventId))
      .orderBy(asc(schema.eventLinks.position));
    return rows;
  }

  async function loadDetail(eventId: string): Promise<AdminEventDetail | null> {
    const [row] = await db
      .select({
        id: schema.events.id,
        publisherId: schema.events.publisherId,
        publisherName: schema.publishers.name,
        title: schema.events.title,
        description: schema.events.description,
        mode: schema.events.mode,
        status: schema.events.status,
        origin: schema.events.origin,
        startsAt: schema.events.startsAt,
        endsAt: schema.events.endsAt,
        timezone: schema.events.timezone,
        venueName: schema.events.venueName,
        lat: sql<number | null>`ST_Y(${schema.events.location}::geometry)`,
        lng: sql<number | null>`ST_X(${schema.events.location}::geometry)`,
        geofenceRadiusM: schema.events.geofenceRadiusM,
        onlineUrl: schema.events.onlineUrl,
        priceAmount: schema.events.priceAmount,
        currency: schema.events.currency,
        meta: schema.events.meta,
        sourceUrl: schema.events.sourceUrl,
        contentVerdict: schema.events.contentVerdict,
        llmOutput: schema.events.llmOutput,
        refId: schema.events.refId,
        workerId: schema.events.workerId,
        featured: schema.events.featured,
        checkInEnabled: schema.events.checkInEnabled,
        createdAt: schema.events.createdAt,
        updatedAt: schema.events.updatedAt,
      })
      .from(schema.events)
      .innerJoin(schema.publishers, eq(schema.events.publisherId, schema.publishers.id))
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!row) return null;
    const lat = row.lat == null ? null : Number(row.lat);
    const lng = row.lng == null ? null : Number(row.lng);
    return {
      id: row.id,
      publisherId: publisherIdOf(row.publisherId),
      publisherName: row.publisherName,
      title: row.title,
      description: row.description,
      mode: row.mode,
      status: row.status,
      origin: row.origin,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      timezone: row.timezone,
      venueName: row.venueName,
      location:
        lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)
          ? { lat, lng }
          : null,
      geofenceRadiusM: row.geofenceRadiusM,
      onlineUrl: row.onlineUrl,
      priceAmount: row.priceAmount,
      currency: row.currency,
      meta: readEventMeta(row.meta),
      sourceUrl: row.sourceUrl,
      refId: row.refId,
      workerId: row.workerId,
      tagIds: await tagIdsFor(eventId),
      links: await linksFor(eventId),
      ...(await imagesFor(eventId)),
      featured: row.featured,
      checkInEnabled: row.checkInEnabled,
      contentVerdict: row.contentVerdict,
      llmOutput: row.llmOutput ?? null,
      warnings: warningsFor(row.meta),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async function replaceTags(eventId: string, tagIds: string[]) {
    const unique = [...new Set(tagIds)];
    if (unique.length > 0) {
      const found = await db
        .select({ id: schema.tags.id })
        .from(schema.tags)
        .where(inArray(schema.tags.id, unique));
      if (found.length !== unique.length) throw new AdminEventError('invalid_event');
    }
    await db.delete(schema.eventTags).where(eq(schema.eventTags.eventId, eventId));
    if (unique.length > 0) {
      await db.insert(schema.eventTags).values(unique.map((tagId) => ({ eventId, tagId })));
    }
  }

  async function replaceLinks(
    eventId: string,
    links: NonNullable<AdminEventPatchRequest['links']>,
  ) {
    await db
      .delete(schema.eventLinks)
      .where(and(eq(schema.eventLinks.eventId, eventId), eq(schema.eventLinks.audience, 'public')));
    if (links.length === 0) return;
    await db.insert(schema.eventLinks).values(
      links.map((link, position) => ({
        eventId,
        type: link.type,
        url: link.url,
        label: link.label ?? null,
        position,
        audience: 'public' as const,
      })),
    );
  }

  return {
    async listInReview() {
      const rows = await db
        .select({
          id: schema.events.id,
          publisherId: schema.events.publisherId,
          publisherName: schema.publishers.name,
          title: schema.events.title,
          mode: schema.events.mode,
          status: schema.events.status,
          origin: schema.events.origin,
          startsAt: schema.events.startsAt,
          endsAt: schema.events.endsAt,
          venueName: schema.events.venueName,
          sourceUrl: schema.events.sourceUrl,
          contentVerdict: schema.events.contentVerdict,
          meta: schema.events.meta,
          createdAt: schema.events.createdAt,
        })
        .from(schema.events)
        .innerJoin(schema.publishers, eq(schema.events.publisherId, schema.publishers.id))
        .where(eq(schema.events.status, 'in_review'))
        .orderBy(asc(schema.events.createdAt), asc(schema.events.id))
        .limit(200);
      return rows
        .filter((r) => r.status === 'in_review')
        .map((r) => ({
          id: r.id,
          publisherId: publisherIdOf(r.publisherId),
          publisherName: r.publisherName,
          title: r.title,
          mode: r.mode,
          status: 'in_review' as const,
          origin: r.origin,
          startsAt: r.startsAt.toISOString(),
          endsAt: r.endsAt.toISOString(),
          venueName: r.venueName,
          sourceUrl: r.sourceUrl,
          contentVerdict: r.contentVerdict,
          warnings: warningsFor(r.meta),
          createdAt: r.createdAt.toISOString(),
        }));
    },
    async list(query) {
      const filters = [];
      if (query.status) filters.push(eq(schema.events.status, query.status));
      if (query.q) {
        const pattern = `%${query.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
        const match = or(
          ilike(schema.events.title, pattern),
          ilike(schema.events.venueName, pattern),
          ilike(schema.publishers.name, pattern),
        );
        if (match) filters.push(match);
      }
      const where = filters.length > 0 ? and(...filters) : undefined;
      const listed = db
        .select({
          id: schema.events.id,
          publisherId: schema.events.publisherId,
          publisherName: schema.publishers.name,
          title: schema.events.title,
          mode: schema.events.mode,
          status: schema.events.status,
          origin: schema.events.origin,
          startsAt: schema.events.startsAt,
          endsAt: schema.events.endsAt,
          venueName: schema.events.venueName,
          sourceUrl: schema.events.sourceUrl,
          featured: schema.events.featured,
          checkInEnabled: schema.events.checkInEnabled,
          contentVerdict: schema.events.contentVerdict,
          meta: schema.events.meta,
          createdAt: schema.events.createdAt,
        })
        .from(schema.events)
        .innerJoin(schema.publishers, eq(schema.events.publisherId, schema.publishers.id));
      const counted = db
        .select({ n: count() })
        .from(schema.events)
        .innerJoin(schema.publishers, eq(schema.events.publisherId, schema.publishers.id));
      const filtered = where ? listed.where(where) : listed;
      const ordered =
        query.sort === 'created'
          ? filtered.orderBy(asc(schema.events.createdAt), asc(schema.events.id))
          : filtered.orderBy(desc(schema.events.startsAt), desc(schema.events.id));
      const [rows, [totalRow]] = await Promise.all([
        ordered.limit(query.limit).offset(query.offset),
        where ? counted.where(where) : counted,
      ]);
      const total = Number(totalRow?.n ?? 0);
      const next = query.offset + rows.length;
      return {
        items: rows.map((r) => ({
          id: r.id,
          publisherId: publisherIdOf(r.publisherId),
          publisherName: r.publisherName,
          title: r.title,
          mode: r.mode,
          status: r.status,
          origin: r.origin,
          startsAt: r.startsAt.toISOString(),
          endsAt: r.endsAt.toISOString(),
          venueName: r.venueName,
          sourceUrl: r.sourceUrl,
          featured: r.featured,
          checkInEnabled: r.checkInEnabled,
          contentVerdict: r.contentVerdict,
          warnings: warningsFor(r.meta),
          createdAt: r.createdAt.toISOString(),
        })),
        total,
        nextOffset: next < total ? next : null,
      };
    },
    async listTags() {
      const rows = await db.select().from(schema.tags).orderBy(asc(schema.tags.slug));
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
      }));
    },
    async get(eventId) {
      return loadDetail(eventId);
    },
    async approve(eventId, actor) {
      const [row] = await db
        .select({
          id: schema.events.id,
          status: schema.events.status,
          title: schema.events.title,
          origin: schema.events.origin,
          publisherId: schema.events.publisherId,
          startsAt: schema.events.startsAt,
        })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);
      if (!row || !canApproveImportedEvent(row.status) || !row.publisherId) return null;
      const at = now();
      const updated = await db
        .update(schema.events)
        .set({ status: 'published', updatedAt: at })
        .where(and(eq(schema.events.id, eventId), eq(schema.events.status, 'in_review')))
        .returning({ id: schema.events.id });
      if (!updated[0]) return null;
      const [publisher] = await db
        .select({
          verified: schema.publishers.verified,
          importNotificationPlan: schema.publishers.importNotificationPlan,
        })
        .from(schema.publishers)
        .where(eq(schema.publishers.id, row.publisherId))
        .limit(1);
      const approvedPlan = publisher
        ? importPlanToSchedule({
            publisherVerified: publisher.verified,
            planId: publisher.importNotificationPlan,
          })
        : null;
      await approvePendingPushMessagesForEvent(db, eventId, at);
      if (approvedPlan) {
        await scheduleImportPlanForEvent(db, {
          eventId,
          eventTitle: row.title,
          startsAt: row.startsAt,
          eventStatus: 'published',
          planId: approvedPlan,
          now: at,
        });
      }
      if (shouldEnqueueNotifications('published')) {
        await enqueueDomainEvent(domainEvents, { type: 'event.published', eventId });
      }
      await audit.write({
        actor,
        action: 'event.approve',
        entityType: 'event',
        entityId: eventId,
        before: { status: row.status },
        after: { status: 'published' },
      });
      return { id: eventId, status: 'published' as const };
    },
    async reject(eventId, actor) {
      const [row] = await db
        .select({ id: schema.events.id, status: schema.events.status })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);
      if (!row || !canRejectImportedEvent(row.status)) return null;
      const at = now();
      const updated = await db
        .update(schema.events)
        .set({ status: 'cancelled', updatedAt: at })
        .where(and(eq(schema.events.id, eventId), eq(schema.events.status, 'in_review')))
        .returning({ id: schema.events.id });
      if (!updated[0]) return null;
      await cancelOpenPushMessages(db, eventId, at);
      await audit.write({
        actor,
        action: 'event.reject',
        entityType: 'event',
        entityId: eventId,
        before: { status: row.status },
        after: { status: 'cancelled' },
      });
      return { id: eventId, status: 'cancelled' as const };
    },
    async softDelete(eventId, actor) {
      const [row] = await db
        .select({
          id: schema.events.id,
          status: schema.events.status,
          origin: schema.events.origin,
        })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);
      if (!row || !canDeleteImportedEvent(row)) return null;
      const at = now();
      const updated = await db
        .update(schema.events)
        .set({ status: 'cancelled', updatedAt: at })
        .where(
          and(
            eq(schema.events.id, eventId),
            eq(schema.events.status, 'in_review'),
            eq(schema.events.origin, 'imported'),
          ),
        )
        .returning({ id: schema.events.id });
      if (!updated[0]) return null;
      await cancelOpenPushMessages(db, eventId, at);
      await audit.write({
        actor,
        action: 'event.delete',
        entityType: 'event',
        entityId: eventId,
        before: { status: row.status },
        after: { status: 'cancelled' },
      });
      return { id: eventId, status: 'cancelled' as const };
    },
    async wipe(eventId, actor) {
      const deleted = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            id: schema.events.id,
            status: schema.events.status,
            origin: schema.events.origin,
            title: schema.events.title,
          })
          .from(schema.events)
          .where(eq(schema.events.id, eventId))
          .limit(1)
          .for('update');
        if (!row || !canDeleteImportedEvent(row)) return null;
        const audience = [
          schema.checkIns,
          schema.ratings,
          schema.savedEvents,
          schema.comingEvents,
          schema.notifications,
        ];
        for (const table of audience) {
          const [hit] = await tx
            .select({ eventId: table.eventId })
            .from(table)
            .where(eq(table.eventId, eventId))
            .limit(1);
          if (hit) return null;
        }
        const refs = await tx
          .select({
            sourceId: schema.externalRefs.sourceId,
            externalId: schema.externalRefs.externalId,
          })
          .from(schema.externalRefs)
          .where(eq(schema.externalRefs.eventId, eventId));
        const removed = await tx
          .delete(schema.events)
          .where(
            and(
              eq(schema.events.id, eventId),
              eq(schema.events.status, 'in_review'),
              eq(schema.events.origin, 'imported'),
            ),
          )
          .returning({ id: schema.events.id });
        if (!removed[0]) return null;
        if (refs.length > 0) {
          await tx.insert(schema.importSuppressions).values(refs).onConflictDoNothing();
        }
        return { id: eventId, before: { status: row.status, title: row.title } };
      });
      if (!deleted) return null;
      await audit.write({
        actor,
        action: 'event.wipe',
        entityType: 'event',
        entityId: eventId,
        before: deleted.before,
        after: null,
      });
      return { id: deleted.id };
    },
    async patch(eventId, body, actor) {
      const existing = await loadDetail(eventId);
      if (!existing) return null;
      assertEditable(existing, body);
      if (body.tagIds) {
        const unique = [...new Set(body.tagIds)];
        if (unique.length > 0) {
          const found = await db
            .select({ id: schema.tags.id })
            .from(schema.tags)
            .where(inArray(schema.tags.id, unique));
          if (found.length !== unique.length) throw new AdminEventError('invalid_event');
        }
      }
      const changed = contentChanges(existing, body);
      const at = now();
      const startsAt = body.startsAt ?? existing.startsAt;
      const endsAt = body.endsAt ?? existing.endsAt;
      const mode = body.mode ?? existing.mode;
      const location = body.location !== undefined ? body.location : existing.location;
      const onlineUrl = body.onlineUrl !== undefined ? body.onlineUrl : existing.onlineUrl;
      const nextStatus = body.status ?? existing.status;
      await db
        .update(schema.events)
        .set({
          title: body.title ?? existing.title,
          description: body.description !== undefined ? body.description : existing.description,
          mode,
          status: nextStatus,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          timezone: body.timezone ?? existing.timezone,
          venueName: body.venueName !== undefined ? body.venueName : existing.venueName,
          location: location ? pointEwkt(location) : null,
          geofenceRadiusM:
            body.geofenceRadiusM !== undefined ? body.geofenceRadiusM : existing.geofenceRadiusM,
          onlineUrl,
          priceAmount: body.priceAmount !== undefined ? body.priceAmount : existing.priceAmount,
          currency: body.currency ?? existing.currency,
          featured: body.featured ?? existing.featured,
          checkInEnabled: body.checkInEnabled ?? existing.checkInEnabled,
          updatedAt: at,
        })
        .where(eq(schema.events.id, eventId));
      if (body.tagIds) await replaceTags(eventId, body.tagIds);
      if (body.links) await replaceLinks(eventId, body.links);
      if (nextStatus === 'cancelled' && existing.status !== 'cancelled') {
        await cancelOpenPushMessages(db, eventId, at);
      } else if (
        nextStatus === 'published' ||
        nextStatus === 'awaiting_verification' ||
        nextStatus === 'in_review'
      ) {
        const [publisher] = await db
          .select({
            verified: schema.publishers.verified,
            importNotificationPlan: schema.publishers.importNotificationPlan,
          })
          .from(schema.publishers)
          .where(eq(schema.publishers.id, existing.publisherId))
          .limit(1);
        const editedPlan =
          existing.origin === 'imported' && nextStatus === 'published' && publisher
            ? importPlanToSchedule({
                publisherVerified: publisher.verified,
                planId: publisher.importNotificationPlan,
              })
            : null;
        if (nextStatus === 'published' && existing.status !== 'published') {
          await approvePendingPushMessagesForEvent(db, eventId, at);
        }
        if (editedPlan) {
          await scheduleImportPlanForEvent(db, {
            eventId,
            eventTitle: body.title ?? existing.title,
            startsAt: new Date(body.startsAt ?? existing.startsAt),
            eventStatus: 'published',
            planId: editedPlan,
            now: at,
          });
        } else if (existing.origin !== 'imported') {
          await upsertEventPushDraft(db, {
            eventId,
            eventTitle: body.title ?? existing.title,
            publisherVerified: publisher?.verified ?? false,
            origin: existing.origin,
            now: at,
          });
        }
      }
      if (nextStatus === 'published' && existing.status !== 'published') {
        await enqueueDomainEvent(domainEvents, { type: 'event.published', eventId });
      } else if (
        existing.status === 'published' &&
        nextStatus === 'published' &&
        changed.length > 0
      ) {
        await enqueueDomainEvent(domainEvents, {
          type: 'event.updated',
          eventId,
          changedFields: changed,
        });
      }
      const updated = await loadDetail(eventId);
      await audit.write({
        actor,
        action: 'event.patch',
        entityType: 'event',
        entityId: eventId,
        before: auditSnapshot(existing),
        after: updated ? auditSnapshot(updated) : null,
      });
      return updated;
    },
  };
}
