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
  type AdminOccasionGroupItem,
  type ContentVerdict,
  type EventMeta,
  type Tag,
  type EventLink,
  readEventMeta,
} from '@local-events/contracts';
import type { Db } from '@local-events/db';
import {
  approvePendingPushMessagesForEvent,
  cancelOpenPushMessages,
  markTipPublished,
  occasionEndsAtSql,
  occasionStartsAtSql,
  occasionVenueNameSql,
  pointEwkt,
  schema,
} from '@local-events/db';
import {
  canApproveImportedEvent,
  canDeleteImportedEvent,
  canRejectImportedEvent,
  canRescanImportedEvent,
  POSTER_IMAGE_ROLE,
  posterImageError,
  publicAssetUrl,
  publicGalleryUrls,
  publicPosterUrl,
  shouldEnqueueNotifications,
  importPlanToSchedule,
  reviewWarnings,
  validateEventFields,
} from '@local-events/domain';
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import type { AdminAuditServices } from './audit';
import { noopAudit } from './audit';
import { createMemoryDomainEventPublisher } from './domain-events/memory';
import { scheduleImportPlanForEvent } from './import-notifications';
import { upsertEventPushDraft } from './push-drafts/drafts';
import { enqueueDomainEvent, type DomainEventPublisher } from './domain-events/types';
import type { PosterStore } from './poster-store';

export class AdminEventError extends Error {
  readonly code:
    | 'invalid_event'
    | 'online_url_required'
    | 'unsupported_type'
    | 'too_large'
    | 'poster_unavailable';

  constructor(
    code:
      | 'invalid_event'
      | 'online_url_required'
      | 'unsupported_type'
      | 'too_large'
      | 'poster_unavailable',
  ) {
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
  /** Send an imported review or published event back to the scan queue. */
  rescan: (eventId: string, actor: string) => Promise<AdminEventDecisionResponse | null>;
  /** Open events that share this event's scan occasion group, including this event. Null when the event is missing. */
  listOccasionGroup: (eventId: string) => Promise<AdminOccasionGroupItem[] | null>;
  /** Move the chosen events' occasion rows onto this event, then delete those events. */
  collapseOccasions: (
    eventId: string,
    eventIds: string[],
    actor: string,
  ) => Promise<AdminEventDetail | null>;
  /** Cancel an in-review import and leave the row, even when people have checked in. */
  softDelete: (eventId: string, actor: string) => Promise<AdminEventDecisionResponse | null>;
  /** Remove an in-review import. Refuses when anyone has checked in, saved, rated, or been notified. */
  wipe: (eventId: string, actor: string) => Promise<AdminEventDeleteResponse | null>;
  patch: (
    eventId: string,
    body: AdminEventPatchRequest,
    actor: string,
  ) => Promise<AdminEventDetail | null>;
  /** Store the sponsored poster. Null when the event is missing. */
  putPoster: (
    eventId: string,
    body: Uint8Array,
    contentType: string,
    actor: string,
  ) => Promise<{ posterUrl: string | null } | null>;
  /** Remove the sponsored poster. Null when the event is missing. */
  deletePoster: (eventId: string, actor: string) => Promise<{ posterUrl: null } | null>;
};

export type AdminEventEnv = {
  now?: () => Date;
  domainEvents?: DomainEventPublisher;
  audit?: AdminAuditServices;
  /** Garage or CloudFront origin. Image URLs are omitted when this is unset. */
  assetsPublicBaseUrl?: string;
  /** Required for a database poster upload. The memory store keeps the key without it. */
  posterStore?: PosterStore;
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
  sponsored?: boolean;
  checkInEnabled?: boolean;
  images?: { role: string; s3Key: string }[];
  occasions?: {
    id: string;
    startsAt: string;
    endsAt: string;
    venueName: string | null;
    location: { lat: number; lng: number } | null;
  }[];
  createdAt: string;
  updatedAt: string;
};

export type AdminEventMemoryStore = {
  publishers: Map<string, { id: string; name: string }>;
  tags?: Map<string, Tag>;
  events: Map<string, MemoryEvent>;
  /** Event ids wipe must leave, matching a check-in, save, rating, or notification. */
  wipeBlocked?: Set<string>;
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
    startsAt: string | null;
    endsAt: string | null;
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
  if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) {
    throw new AdminEventError('invalid_event');
  }
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
    startsAt: string | null;
    endsAt: string | null;
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
    sponsored?: boolean;
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
  if (body.sponsored !== undefined) {
    note('sponsored', body.sponsored !== (existing.sponsored ?? false));
  }
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
    sponsored: detail.sponsored,
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

function tagCountOf(tagIds: readonly string[] | undefined): number {
  return tagIds?.length ?? 0;
}

/** Correlated count of `event_tags` for the event row in the outer query. */
function tagCountColumn() {
  return sql<number>`(
    select count(*)::int
    from ${schema.eventTags}
    where ${schema.eventTags.eventId} = ${schema.events.id}
  )`;
}

/** Events with no `event_tags` rows. */
function untaggedEvents() {
  return sql`not exists (
    select 1
    from ${schema.eventTags}
    where ${schema.eventTags.eventId} = ${schema.events.id}
  )`;
}

function isoDate(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return value.toISOString();
}

function deleteLaterCopies(
  table:
    | typeof schema.eventOccasions
    | typeof schema.savedEvents
    | typeof schema.comingEvents
    | typeof schema.eventListItems
    | typeof schema.checkIns
    | typeof schema.ratings
    | typeof schema.eventReports
    | typeof schema.eventTags
    | typeof schema.eventTranslations
    | typeof schema.eventImages,
  column: string,
  childIdsSql: ReturnType<typeof sql.join>,
) {
  const key = sql.raw(column);
  return sql`
    delete from ${table} drop_row
    using ${table} keep_row
    where drop_row.event_id in (${childIdsSql})
      and keep_row.event_id in (${childIdsSql})
      and drop_row.${key} is not null
      and drop_row.${key} = keep_row.${key}
      and drop_row.ctid > keep_row.ctid
  `;
}

function metaWithoutScanGroup(meta: EventMeta): EventMeta {
  const { possibleOccasionGroupId: _group, ...rest } = meta;
  return rest;
}

function occasionRows(event: MemoryEvent): NonNullable<MemoryEvent['occasions']> {
  if (event.occasions && event.occasions.length > 0) {
    return event.occasions.map((row) => ({
      id: row.id,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      venueName: row.venueName,
      location: row.location,
    }));
  }
  return [
    {
      id: randomUUID(),
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      venueName: event.venueName,
      location: event.location ?? null,
    },
  ];
}

function applyOccasionBounds(
  event: MemoryEvent,
  rows: NonNullable<MemoryEvent['occasions']>,
): void {
  const sorted = [...rows].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
  );
  const first = sorted[0];
  if (!first) return;
  let endsAt = first.endsAt;
  for (const row of sorted) {
    if (row.endsAt > endsAt) endsAt = row.endsAt;
  }
  event.occasions = sorted;
  event.startsAt = first.startsAt;
  event.endsAt = endsAt;
  event.venueName = first.venueName;
  event.location = first.location;
}

function listedTimes(event: MemoryEvent): {
  startsAt: string | null;
  endsAt: string | null;
  venueName: string | null;
} {
  const rows = event.occasions;
  if (!rows || rows.length === 0) {
    return { startsAt: event.startsAt, endsAt: event.endsAt, venueName: event.venueName };
  }
  const sorted = [...rows].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
  );
  const first = sorted[0]!;
  let endsAt = first.endsAt;
  for (const row of sorted) {
    if (row.endsAt > endsAt) endsAt = row.endsAt;
  }
  return { startsAt: first.startsAt, endsAt, venueName: first.venueName };
}

const OPEN_OCCASION_STATUSES = [
  'draft',
  'awaiting_verification',
  'pending_scan',
  'in_review',
  'published',
] as const;

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
    sponsored: e.sponsored ?? false,
    checkInEnabled: e.checkInEnabled ?? false,
    contentVerdict: contentVerdictOf(e.contentVerdict),
    tagCount: tagCountOf(e.tagIds),
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
): Pick<AdminEventDetail, 'imageUrl' | 'imageUrls' | 'posterUrl'> {
  const main = images.find((image) => image.role === 'main')?.s3Key ?? null;
  return {
    imageUrl: publicAssetUrl(assetsPublicBaseUrl, main),
    imageUrls: publicGalleryUrls(assetsPublicBaseUrl, images),
    posterUrl: publicPosterUrl(assetsPublicBaseUrl, images),
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
    ...(e.occasions && e.occasions.length > 0 ? { occasions: e.occasions } : {}),
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
  if (body.sponsored !== undefined) row.sponsored = body.sponsored;
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
          tagCount: tagCountOf(e.tagIds),
          warnings: warningsFor(e.meta),
          createdAt: e.createdAt,
        }));
    },
    async list(query) {
      const needle = query.q?.toLocaleLowerCase();
      const matched = [...store.events.values()]
        .filter((e) => {
          if (e.status === 'deleted') return false;
          if (query.status && e.status !== query.status) return false;
          if (query.untagged === 'true' && tagCountOf(e.tagIds) > 0) return false;
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
    async rescan(eventId, actor) {
      const row = store.events.get(eventId);
      if (!row || !canRescanImportedEvent(row)) return null;
      const before = { status: row.status };
      row.status = 'pending_scan';
      row.updatedAt = now().toISOString();
      await audit.write({
        actor,
        action: 'event.rescan',
        entityType: 'event',
        entityId: eventId,
        before,
        after: { status: 'pending_scan' },
      });
      return { id: row.id, status: 'pending_scan' as const };
    },
    async softDelete(eventId, actor) {
      const row = store.events.get(eventId);
      if (!row || !canDeleteImportedEvent(row)) return null;
      const before = { status: row.status };
      row.status = 'deleted';
      row.updatedAt = now().toISOString();
      await audit.write({
        actor,
        action: 'event.delete',
        entityType: 'event',
        entityId: eventId,
        before,
        after: { status: 'deleted' },
      });
      return { id: row.id, status: 'deleted' as const };
    },
    async wipe(eventId, actor) {
      const row = store.events.get(eventId);
      if (!row || store.wipeBlocked?.has(eventId)) return null;
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
    async listOccasionGroup(eventId) {
      const host = store.events.get(eventId);
      if (!host) return null;
      const groupId = readEventMeta(host.meta).possibleOccasionGroupId;
      if (!groupId) return [];
      return [...store.events.values()]
        .filter(
          (event) =>
            readEventMeta(event.meta).possibleOccasionGroupId === groupId &&
            event.status !== 'cancelled' &&
            event.status !== 'ended' &&
            event.status !== 'deleted',
        )
        .sort((a, b) => {
          const left = listedTimes(a);
          const right = listedTimes(b);
          return (
            (left.startsAt ?? '').localeCompare(right.startsAt ?? '') || a.id.localeCompare(b.id)
          );
        })
        .map((event) => {
          const times = listedTimes(event);
          return {
            id: event.id,
            title: event.title,
            status: event.status as AdminOccasionGroupItem['status'],
            startsAt: times.startsAt,
            endsAt: times.endsAt,
            venueName: times.venueName,
          };
        });
    },
    async collapseOccasions(eventId, eventIds, actor) {
      const host = store.events.get(eventId);
      const hostMeta = readEventMeta(host?.meta);
      if (!host || !hostMeta.possibleOccasionGroupId) return null;
      const unique = [...new Set(eventIds)];
      if (unique.length !== eventIds.length || unique.includes(eventId)) {
        throw new AdminEventError('invalid_event');
      }
      const members = unique.map((id) => store.events.get(id));
      if (
        members.some(
          (event) =>
            !event ||
            readEventMeta(event.meta).possibleOccasionGroupId !==
              hostMeta.possibleOccasionGroupId ||
            event.status === 'cancelled' ||
            event.status === 'ended' ||
            event.status === 'deleted',
        )
      ) {
        throw new AdminEventError('invalid_event');
      }
      const chosen = members.filter((event) => event != null);
      const rows = [occasionRows(host), ...chosen.map((event) => occasionRows(event))].flat();
      if (rows.length < 2) throw new AdminEventError('invalid_event');
      const at = now().toISOString();
      const groupId = hostMeta.possibleOccasionGroupId;
      applyOccasionBounds(host, rows);
      for (const event of chosen) store.events.delete(event.id);
      const stillOpen = [...store.events.values()].some(
        (event) =>
          event.id !== host.id &&
          readEventMeta(event.meta).possibleOccasionGroupId === groupId &&
          event.status !== 'cancelled' &&
          event.status !== 'ended' &&
          event.status !== 'deleted',
      );
      if (!stillOpen) host.meta = metaWithoutScanGroup(hostMeta);
      host.updatedAt = at;
      if (host.status === 'published') {
        await enqueueDomainEvent(domainEvents, {
          type: 'event.updated',
          eventId,
          changedFields: ['occasions'],
        });
      }
      await audit.write({
        actor,
        action: 'event.collapse',
        entityType: 'event',
        entityId: eventId,
        before: { possibleOccasionGroupId: groupId },
        after: { mergedEventIds: unique },
      });
      return asDetail(
        host,
        store.publishers.get(host.publisherId)?.name ?? 'Unknown',
        env.assetsPublicBaseUrl,
      );
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
    async putPoster(eventId, body, contentType, actor) {
      const row = store.events.get(eventId);
      if (!row) return null;
      const problem = posterImageError(contentType, body);
      if (problem) throw new AdminEventError(problem);
      const key = `events/${eventId}/${POSTER_IMAGE_ROLE}/${randomUUID()}`;
      const publisherName = store.publishers.get(row.publisherId)?.name ?? 'Unknown';
      const before = asDetail(row, publisherName, env.assetsPublicBaseUrl);
      row.images = [
        ...(row.images ?? []).filter((image) => image.role !== POSTER_IMAGE_ROLE),
        { role: POSTER_IMAGE_ROLE, s3Key: key },
      ];
      row.updatedAt = now().toISOString();
      if (row.status === 'published') {
        await enqueueDomainEvent(domainEvents, {
          type: 'event.updated',
          eventId,
          changedFields: ['poster'],
        });
      }
      const after = asDetail(row, publisherName, env.assetsPublicBaseUrl);
      await audit.write({
        actor,
        action: 'event.poster',
        entityType: 'event',
        entityId: eventId,
        before: { posterUrl: before.posterUrl },
        after: { posterUrl: after.posterUrl },
      });
      return { posterUrl: after.posterUrl };
    },
    async deletePoster(eventId, actor) {
      const row = store.events.get(eventId);
      if (!row) return null;
      const publisherName = store.publishers.get(row.publisherId)?.name ?? 'Unknown';
      const before = asDetail(row, publisherName, env.assetsPublicBaseUrl);
      const hadPoster = (row.images ?? []).some((image) => image.role === POSTER_IMAGE_ROLE);
      row.images = (row.images ?? []).filter((image) => image.role !== POSTER_IMAGE_ROLE);
      row.updatedAt = now().toISOString();
      if (hadPoster && row.status === 'published') {
        await enqueueDomainEvent(domainEvents, {
          type: 'event.updated',
          eventId,
          changedFields: ['poster'],
        });
      }
      const after = asDetail(row, publisherName, env.assetsPublicBaseUrl);
      await audit.write({
        actor,
        action: 'event.poster',
        entityType: 'event',
        entityId: eventId,
        before: { posterUrl: before.posterUrl },
        after: { posterUrl: after.posterUrl },
      });
      return { posterUrl: null };
    },
  };
}

export function createDbAdminEventServices(db: Db, env: AdminEventEnv = {}): AdminEventServices {
  const now = env.now ?? (() => new Date());
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();
  const audit = env.audit ?? noopAudit;

  async function publishLinkedTip(eventId: string): Promise<void> {
    const tip = await markTipPublished(db, eventId, now());
    if (!tip) return;
    await enqueueDomainEvent(domainEvents, {
      type: 'tip.scanned',
      tipId: tip.id,
      eventId,
      status: 'published',
      followUp: true,
    });
  }

  async function tagIdsFor(eventId: string): Promise<string[]> {
    const rows = await db
      .select({ tagId: schema.eventTags.tagId })
      .from(schema.eventTags)
      .where(eq(schema.eventTags.eventId, eventId));
    return rows.map((row) => row.tagId);
  }

  async function imagesFor(
    eventId: string,
  ): Promise<Pick<AdminEventDetail, 'imageUrl' | 'imageUrls' | 'posterUrl'>> {
    const rows = await db
      .select({ role: schema.eventImages.role, s3Key: schema.eventImages.s3Key })
      .from(schema.eventImages)
      .where(eq(schema.eventImages.eventId, eventId));
    return imageFields(rows, env.assetsPublicBaseUrl);
  }

  async function occasionsFor(
    eventId: string,
  ): Promise<NonNullable<AdminEventDetail['occasions']>> {
    const rows = await db
      .select({
        id: schema.eventOccasions.id,
        startsAt: schema.eventOccasions.startsAt,
        endsAt: schema.eventOccasions.endsAt,
        venueName: schema.eventOccasions.venueName,
        lat: sql<number | null>`ST_Y(${schema.eventOccasions.location}::geometry)`,
        lng: sql<number | null>`ST_X(${schema.eventOccasions.location}::geometry)`,
      })
      .from(schema.eventOccasions)
      .where(eq(schema.eventOccasions.eventId, eventId))
      .orderBy(asc(schema.eventOccasions.startsAt), asc(schema.eventOccasions.id));
    return rows.map((row) => {
      const lat = row.lat == null ? null : Number(row.lat);
      const lng = row.lng == null ? null : Number(row.lng);
      return {
        id: row.id,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        venueName: row.venueName,
        location:
          lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)
            ? { lat, lng }
            : null,
      };
    });
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
        startsAt: sql<Date | null>`(
          select min(${schema.eventOccasions.startsAt})
          from ${schema.eventOccasions}
          where ${schema.eventOccasions.eventId} = ${schema.events.id}
        )`,
        endsAt: sql<Date | null>`(
          select max(${schema.eventOccasions.endsAt})
          from ${schema.eventOccasions}
          where ${schema.eventOccasions.eventId} = ${schema.events.id}
        )`,
        timezone: schema.events.timezone,
        venueName: sql<string | null>`(
          select ${schema.eventOccasions.venueName}
          from ${schema.eventOccasions}
          where ${schema.eventOccasions.eventId} = ${schema.events.id}
          order by ${schema.eventOccasions.startsAt} asc
          limit 1
        )`,
        lat: sql<number | null>`(
          select ST_Y(${schema.eventOccasions.location}::geometry)
          from ${schema.eventOccasions}
          where ${schema.eventOccasions.eventId} = ${schema.events.id}
          order by ${schema.eventOccasions.startsAt} asc
          limit 1
        )`,
        lng: sql<number | null>`(
          select ST_X(${schema.eventOccasions.location}::geometry)
          from ${schema.eventOccasions}
          where ${schema.eventOccasions.eventId} = ${schema.events.id}
          order by ${schema.eventOccasions.startsAt} asc
          limit 1
        )`,
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
        sponsored: schema.events.sponsored,
        checkInEnabled: schema.events.checkInEnabled,
        createdAt: schema.events.createdAt,
        updatedAt: schema.events.updatedAt,
      })
      .from(schema.events)
      .leftJoin(schema.publishers, eq(schema.events.publisherId, schema.publishers.id))
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!row) return null;
    const lat = row.lat == null ? null : Number(row.lat);
    const lng = row.lng == null ? null : Number(row.lng);
    const tagIds = await tagIdsFor(eventId);
    return {
      id: row.id,
      publisherId: row.publisherId,
      publisherName: row.publisherName ?? '',
      title: row.title,
      description: row.description,
      mode: row.mode,
      status: row.status,
      origin: row.origin,
      startsAt: isoDate(row.startsAt),
      endsAt: isoDate(row.endsAt),
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
      tagIds,
      tagCount: tagIds.length,
      links: await linksFor(eventId),
      occasions: await occasionsFor(eventId),
      ...(await imagesFor(eventId)),
      featured: row.featured,
      sponsored: row.sponsored,
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

  async function replaceOccasions(
    eventId: string,
    input: {
      startsAt?: string;
      endsAt?: string;
      venueName?: string | null;
      location?: { lat: number; lng: number } | null;
      occasions?: {
        startsAt: string;
        endsAt: string;
        venueName?: string | null;
        location?: { lat: number; lng: number } | null;
      }[];
    },
  ) {
    const rows =
      input.occasions && input.occasions.length > 0
        ? input.occasions
        : input.startsAt && input.endsAt
          ? [
              {
                startsAt: input.startsAt,
                endsAt: input.endsAt,
                venueName: input.venueName ?? null,
                location: input.location ?? null,
              },
            ]
          : [];
    if (rows.length === 0) return;
    await db.transaction(async (tx) => {
      await tx.delete(schema.eventOccasions).where(eq(schema.eventOccasions.eventId, eventId));
      await tx.insert(schema.eventOccasions).values(
        rows.map((row) => ({
          eventId,
          startsAt: new Date(row.startsAt),
          endsAt: new Date(row.endsAt),
          venueName: row.venueName ?? null,
          location: row.location ? pointEwkt(row.location) : null,
          sourceKey: `${row.startsAt}:${row.endsAt}`,
        })),
      );
    });
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
          startsAt: sql<Date | null>`(
            select min(${schema.eventOccasions.startsAt})
            from ${schema.eventOccasions}
            where ${schema.eventOccasions.eventId} = ${schema.events.id}
          )`,
          endsAt: sql<Date | null>`(
            select max(${schema.eventOccasions.endsAt})
            from ${schema.eventOccasions}
            where ${schema.eventOccasions.eventId} = ${schema.events.id}
          )`,
          venueName: sql<string | null>`(
            select ${schema.eventOccasions.venueName}
            from ${schema.eventOccasions}
            where ${schema.eventOccasions.eventId} = ${schema.events.id}
            order by ${schema.eventOccasions.startsAt} asc
            limit 1
          )`,
          sourceUrl: schema.events.sourceUrl,
          contentVerdict: schema.events.contentVerdict,
          tagCount: tagCountColumn(),
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
          startsAt: isoDate(r.startsAt),
          endsAt: isoDate(r.endsAt),
          venueName: r.venueName,
          sourceUrl: r.sourceUrl,
          contentVerdict: r.contentVerdict,
          tagCount: Number(r.tagCount),
          warnings: warningsFor(r.meta),
          createdAt: r.createdAt.toISOString(),
        }));
    },
    async list(query) {
      const filters = [ne(schema.events.status, 'deleted')];
      if (query.status) filters.push(eq(schema.events.status, query.status));
      if (query.untagged === 'true') filters.push(untaggedEvents());
      if (query.q) {
        const pattern = `%${query.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
        const match = or(
          ilike(schema.events.title, pattern),
          sql`exists (
            select 1 from ${schema.eventOccasions} eo
            where eo.event_id = ${schema.events.id}
              and eo.venue_name ilike ${pattern}
          )`,
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
          startsAt: sql<Date | null>`(
            select min(${schema.eventOccasions.startsAt})
            from ${schema.eventOccasions}
            where ${schema.eventOccasions.eventId} = ${schema.events.id}
          )`,
          endsAt: sql<Date | null>`(
            select max(${schema.eventOccasions.endsAt})
            from ${schema.eventOccasions}
            where ${schema.eventOccasions.eventId} = ${schema.events.id}
          )`,
          venueName: sql<string | null>`(
            select ${schema.eventOccasions.venueName}
            from ${schema.eventOccasions}
            where ${schema.eventOccasions.eventId} = ${schema.events.id}
            order by ${schema.eventOccasions.startsAt} asc
            limit 1
          )`,
          sourceUrl: schema.events.sourceUrl,
          featured: schema.events.featured,
          sponsored: schema.events.sponsored,
          checkInEnabled: schema.events.checkInEnabled,
          contentVerdict: schema.events.contentVerdict,
          tagCount: tagCountColumn(),
          meta: schema.events.meta,
          createdAt: schema.events.createdAt,
        })
        .from(schema.events)
        .leftJoin(schema.publishers, eq(schema.events.publisherId, schema.publishers.id));
      const counted = db
        .select({ n: count() })
        .from(schema.events)
        .leftJoin(schema.publishers, eq(schema.events.publisherId, schema.publishers.id));
      const filtered = where ? listed.where(where) : listed;
      const ordered =
        query.sort === 'created'
          ? filtered.orderBy(asc(schema.events.createdAt), asc(schema.events.id))
          : filtered.orderBy(
              sql`(
                select min(${schema.eventOccasions.startsAt})
                from ${schema.eventOccasions}
                where ${schema.eventOccasions.eventId} = ${schema.events.id}
              ) desc`,
              desc(schema.events.id),
            );
      const [rows, [totalRow]] = await Promise.all([
        ordered.limit(query.limit).offset(query.offset),
        where ? counted.where(where) : counted,
      ]);
      const total = Number(totalRow?.n ?? 0);
      const next = query.offset + rows.length;
      return {
        items: rows.map((r) => ({
          id: r.id,
          publisherId: r.publisherId,
          publisherName: r.publisherName ?? '',
          title: r.title,
          mode: r.mode,
          status: r.status,
          origin: r.origin,
          startsAt: isoDate(r.startsAt),
          endsAt: isoDate(r.endsAt),
          venueName: r.venueName,
          sourceUrl: r.sourceUrl,
          featured: r.featured,
          sponsored: r.sponsored,
          checkInEnabled: r.checkInEnabled,
          contentVerdict: r.contentVerdict,
          tagCount: Number(r.tagCount),
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
          startsAt: occasionStartsAtSql(),
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
          status: schema.publishers.status,
          importNotificationPlan: schema.publishers.importNotificationPlan,
        })
        .from(schema.publishers)
        .where(eq(schema.publishers.id, row.publisherId))
        .limit(1);
      const approvedPlan = publisher
        ? importPlanToSchedule({
            publisherStatus: publisher.status,
            planId: publisher.importNotificationPlan,
          })
        : null;
      await approvePendingPushMessagesForEvent(db, eventId, at);
      if (approvedPlan && row.startsAt) {
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
      await publishLinkedTip(eventId);
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
    async rescan(eventId, actor) {
      const [row] = await db
        .select({
          id: schema.events.id,
          status: schema.events.status,
          origin: schema.events.origin,
        })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);
      if (!row || !canRescanImportedEvent(row)) return null;
      const at = now();
      const updated = await db
        .update(schema.events)
        .set({ status: 'pending_scan', scanClaimedUntil: null, updatedAt: at })
        .where(
          and(
            eq(schema.events.id, eventId),
            inArray(schema.events.status, ['in_review', 'published']),
            eq(schema.events.origin, 'imported'),
          ),
        )
        .returning({ id: schema.events.id });
      if (!updated[0]) return null;
      await cancelOpenPushMessages(db, eventId, at);
      await audit.write({
        actor,
        action: 'event.rescan',
        entityType: 'event',
        entityId: eventId,
        before: { status: row.status },
        after: { status: 'pending_scan' },
      });
      return { id: eventId, status: 'pending_scan' as const };
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
        .set({ status: 'deleted', updatedAt: at })
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
        after: { status: 'deleted' },
      });
      return { id: eventId, status: 'deleted' as const };
    },
    async wipe(eventId, actor) {
      const deleted = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            id: schema.events.id,
            status: schema.events.status,
            title: schema.events.title,
          })
          .from(schema.events)
          .where(eq(schema.events.id, eventId))
          .limit(1)
          .for('update');
        if (!row) return null;
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
          .where(eq(schema.events.id, eventId))
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
    async listOccasionGroup(eventId) {
      const [host] = await db
        .select({ meta: schema.events.meta })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);
      if (!host) return null;
      const groupId = readEventMeta(host.meta).possibleOccasionGroupId;
      if (!groupId) return [];
      const rows = await db
        .select({
          id: schema.events.id,
          title: schema.events.title,
          status: schema.events.status,
          startsAt: occasionStartsAtSql(),
          endsAt: occasionEndsAtSql(),
          venueName: occasionVenueNameSql(),
        })
        .from(schema.events)
        .where(
          and(
            sql`${schema.events.meta}->>'possibleOccasionGroupId' = ${groupId}`,
            inArray(schema.events.status, [...OPEN_OCCASION_STATUSES]),
          ),
        )
        .orderBy(occasionStartsAtSql(), asc(schema.events.id));
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        startsAt: isoDate(row.startsAt),
        endsAt: isoDate(row.endsAt),
        venueName: row.venueName,
      }));
    },
    async collapseOccasions(eventId, eventIds, actor) {
      const host = await loadDetail(eventId);
      const groupId = host?.meta.possibleOccasionGroupId;
      if (!host || !groupId) return null;
      const unique = [...new Set(eventIds)];
      if (unique.length !== eventIds.length || unique.includes(eventId)) {
        throw new AdminEventError('invalid_event');
      }
      const rows = await db
        .select({
          id: schema.events.id,
          status: schema.events.status,
          meta: schema.events.meta,
        })
        .from(schema.events)
        .where(inArray(schema.events.id, unique));
      if (rows.length !== unique.length) throw new AdminEventError('invalid_event');
      const at = now();
      for (const row of rows) {
        const meta = readEventMeta(row.meta);
        if (
          meta.possibleOccasionGroupId !== groupId ||
          row.status === 'cancelled' ||
          row.status === 'ended' ||
          row.status === 'deleted'
        ) {
          throw new AdminEventError('invalid_event');
        }
      }
      const childIdsSql = sql.join(
        unique.map((id) => sql`${id}`),
        sql`, `,
      );
      await db.transaction(async (tx) => {
        const locked = await tx
          .select({
            id: schema.events.id,
            status: schema.events.status,
            meta: schema.events.meta,
          })
          .from(schema.events)
          .where(inArray(schema.events.id, [eventId, ...unique]))
          .for('update');
        const lockedHost = locked.find((row) => row.id === eventId);
        const membersStillOpen = unique.every((id) => {
          const row = locked.find((item) => item.id === id);
          if (!row) return false;
          return (
            readEventMeta(row.meta).possibleOccasionGroupId === groupId &&
            row.status !== 'cancelled' &&
            row.status !== 'ended' &&
            row.status !== 'deleted'
          );
        });
        if (
          !lockedHost ||
          readEventMeta(lockedHost.meta).possibleOccasionGroupId !== groupId ||
          !membersStillOpen
        ) {
          throw new AdminEventError('invalid_event');
        }
        await tx.execute(deleteLaterCopies(schema.eventOccasions, 'source_key', childIdsSql));
        await tx.execute(deleteLaterCopies(schema.savedEvents, 'user_id', childIdsSql));
        await tx.execute(deleteLaterCopies(schema.comingEvents, 'user_id', childIdsSql));
        await tx.execute(deleteLaterCopies(schema.eventListItems, 'list_id', childIdsSql));
        await tx.execute(deleteLaterCopies(schema.checkIns, 'user_id', childIdsSql));
        await tx.execute(deleteLaterCopies(schema.ratings, 'user_id', childIdsSql));
        await tx.execute(deleteLaterCopies(schema.eventReports, 'user_id', childIdsSql));
        await tx.execute(deleteLaterCopies(schema.eventTags, 'tag_id', childIdsSql));
        await tx.execute(deleteLaterCopies(schema.eventTranslations, 'language', childIdsSql));
        await tx.execute(deleteLaterCopies(schema.eventImages, 'role', childIdsSql));
        await tx.execute(sql`
          delete from ${schema.subscriptions} drop_row
          using ${schema.subscriptions} keep_row
          where drop_row.target_type = 'event'
            and keep_row.target_type = 'event'
            and drop_row.target_id in (${childIdsSql})
            and keep_row.target_id in (${childIdsSql})
            and drop_row.user_id = keep_row.user_id
            and drop_row.ctid > keep_row.ctid
        `);
        await tx.execute(sql`
          delete from ${schema.eventOccasions} child
          using ${schema.eventOccasions} host_occ
          where child.event_id in (${childIdsSql})
            and host_occ.event_id = ${eventId}
            and child.source_key is not null
            and child.source_key = host_occ.source_key
        `);
        await tx
          .update(schema.eventOccasions)
          .set({ eventId, updatedAt: at })
          .where(inArray(schema.eventOccasions.eventId, unique));
        await tx.execute(sql`
          delete from ${schema.savedEvents} child
          using ${schema.savedEvents} host_row
          where child.event_id in (${childIdsSql})
            and host_row.event_id = ${eventId}
            and child.user_id = host_row.user_id
        `);
        await tx
          .update(schema.savedEvents)
          .set({ eventId })
          .where(inArray(schema.savedEvents.eventId, unique));
        await tx.execute(sql`
          delete from ${schema.comingEvents} child
          using ${schema.comingEvents} host_row
          where child.event_id in (${childIdsSql})
            and host_row.event_id = ${eventId}
            and child.user_id = host_row.user_id
        `);
        await tx
          .update(schema.comingEvents)
          .set({ eventId })
          .where(inArray(schema.comingEvents.eventId, unique));
        await tx.execute(sql`
          delete from ${schema.eventListItems} child
          using ${schema.eventListItems} host_row
          where child.event_id in (${childIdsSql})
            and host_row.event_id = ${eventId}
            and child.list_id = host_row.list_id
        `);
        await tx
          .update(schema.eventListItems)
          .set({ eventId })
          .where(inArray(schema.eventListItems.eventId, unique));
        await tx.execute(sql`
          delete from ${schema.checkIns} child
          using ${schema.checkIns} host_row
          where child.event_id in (${childIdsSql})
            and host_row.event_id = ${eventId}
            and child.user_id = host_row.user_id
        `);
        await tx
          .update(schema.checkIns)
          .set({ eventId })
          .where(inArray(schema.checkIns.eventId, unique));
        await tx.execute(sql`
          delete from ${schema.ratings} child
          using ${schema.ratings} host_row
          where child.event_id in (${childIdsSql})
            and host_row.event_id = ${eventId}
            and child.user_id = host_row.user_id
        `);
        await tx
          .update(schema.ratings)
          .set({ eventId })
          .where(inArray(schema.ratings.eventId, unique));
        await tx.execute(sql`
          delete from ${schema.eventReports} child
          using ${schema.eventReports} host_row
          where child.event_id in (${childIdsSql})
            and host_row.event_id = ${eventId}
            and child.user_id = host_row.user_id
        `);
        await tx
          .update(schema.eventReports)
          .set({ eventId })
          .where(inArray(schema.eventReports.eventId, unique));
        await tx.execute(sql`
          delete from ${schema.eventTags} child
          using ${schema.eventTags} host_row
          where child.event_id in (${childIdsSql})
            and host_row.event_id = ${eventId}
            and child.tag_id = host_row.tag_id
        `);
        await tx
          .update(schema.eventTags)
          .set({ eventId })
          .where(inArray(schema.eventTags.eventId, unique));
        await tx.execute(sql`
          delete from ${schema.eventTranslations} child
          using ${schema.eventTranslations} host_row
          where child.event_id in (${childIdsSql})
            and host_row.event_id = ${eventId}
            and child.language = host_row.language
        `);
        await tx
          .update(schema.eventTranslations)
          .set({ eventId })
          .where(inArray(schema.eventTranslations.eventId, unique));
        await tx.execute(sql`
          delete from ${schema.subscriptions} child
          using ${schema.subscriptions} host_row
          where child.target_type = 'event'
            and child.target_id in (${childIdsSql})
            and host_row.target_type = 'event'
            and host_row.target_id = ${eventId}
            and child.user_id = host_row.user_id
        `);
        await tx
          .update(schema.subscriptions)
          .set({ targetId: eventId })
          .where(
            and(
              eq(schema.subscriptions.targetType, 'event'),
              inArray(schema.subscriptions.targetId, unique),
            ),
          );
        await tx.execute(sql`
          delete from ${schema.eventImages} child
          using ${schema.eventImages} host_row
          where child.event_id in (${childIdsSql})
            and host_row.event_id = ${eventId}
            and child.role = host_row.role
        `);
        await tx
          .update(schema.eventImages)
          .set({ eventId })
          .where(inArray(schema.eventImages.eventId, unique));
        await tx
          .update(schema.eventLinks)
          .set({ eventId })
          .where(inArray(schema.eventLinks.eventId, unique));
        await tx
          .update(schema.eventContent)
          .set({ eventId })
          .where(inArray(schema.eventContent.eventId, unique));
        await tx
          .update(schema.pushMessages)
          .set({ eventId, updatedAt: at })
          .where(inArray(schema.pushMessages.eventId, unique));
        await tx
          .update(schema.notifications)
          .set({ eventId })
          .where(inArray(schema.notifications.eventId, unique));
        await tx
          .update(schema.eventTips)
          .set({ eventId, updatedAt: at })
          .where(inArray(schema.eventTips.eventId, unique));
        await tx.execute(sql`
          insert into ${schema.stats} ("source_type", "source_id", "key", "value", "created_at", "updated_at")
          select 'event', ${eventId}, s."key", sum(s."value"), min(s."created_at"), max(s."updated_at")
          from ${schema.stats} s
          where s."source_type" = 'event'
            and s."source_id" in (${childIdsSql})
          group by s."key"
          on conflict ("source_type", "source_id", "key")
          do update set
            "value" = ${schema.stats}.value + excluded.value,
            "updated_at" = greatest(${schema.stats}.updated_at, excluded.updated_at)
        `);
        await tx.execute(sql`
          delete from ${schema.stats}
          where "source_type" = 'event'
            and "source_id" in (${childIdsSql})
        `);
        await tx.execute(sql`
          delete from ${schema.externalRefs} child
          using ${schema.externalRefs} host_row
          where child.event_id in (${childIdsSql})
            and host_row.event_id = ${eventId}
            and child.source_id = host_row.source_id
            and child.external_id = host_row.external_id
        `);
        await tx
          .update(schema.externalRefs)
          .set({ eventId, lastSeenAt: at })
          .where(inArray(schema.externalRefs.eventId, unique));
        await tx.delete(schema.events).where(inArray(schema.events.id, unique));
        const [remaining] = await tx
          .select({ id: schema.events.id })
          .from(schema.events)
          .where(
            and(
              sql`${schema.events.meta}->>'possibleOccasionGroupId' = ${groupId}`,
              inArray(schema.events.status, [...OPEN_OCCASION_STATUSES]),
              ne(schema.events.id, eventId),
            ),
          )
          .limit(1);
        await tx
          .update(schema.events)
          .set({
            ...(remaining ? {} : { meta: sql`${schema.events.meta} - 'possibleOccasionGroupId'` }),
            updatedAt: at,
          })
          .where(eq(schema.events.id, eventId));
      });
      if (host.status === 'published') {
        await enqueueDomainEvent(domainEvents, {
          type: 'event.updated',
          eventId,
          changedFields: ['occasions'],
        });
      }
      const updated = await loadDetail(eventId);
      await audit.write({
        actor,
        action: 'event.collapse',
        entityType: 'event',
        entityId: eventId,
        before: { possibleOccasionGroupId: groupId },
        after: { mergedEventIds: unique },
      });
      return updated;
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
          timezone: body.timezone ?? existing.timezone,
          geofenceRadiusM:
            body.geofenceRadiusM !== undefined ? body.geofenceRadiusM : existing.geofenceRadiusM,
          onlineUrl,
          priceAmount: body.priceAmount !== undefined ? body.priceAmount : existing.priceAmount,
          currency: body.currency ?? existing.currency,
          featured: body.featured ?? existing.featured,
          sponsored: body.sponsored ?? existing.sponsored,
          checkInEnabled: body.checkInEnabled ?? existing.checkInEnabled,
          updatedAt: at,
        })
        .where(eq(schema.events.id, eventId));
      if (body.occasions || (body.startsAt !== undefined && body.endsAt !== undefined)) {
        await replaceOccasions(eventId, {
          startsAt: startsAt ?? undefined,
          endsAt: endsAt ?? undefined,
          venueName: body.venueName !== undefined ? body.venueName : existing.venueName,
          location,
          occasions: body.occasions,
        });
      }
      if (body.tagIds) await replaceTags(eventId, body.tagIds);
      if (body.links) await replaceLinks(eventId, body.links);
      if (
        (nextStatus === 'cancelled' || nextStatus === 'deleted') &&
        nextStatus !== existing.status
      ) {
        await cancelOpenPushMessages(db, eventId, at);
      } else if (
        nextStatus === 'published' ||
        nextStatus === 'awaiting_verification' ||
        nextStatus === 'in_review'
      ) {
        const [publisher] = existing.publisherId
          ? await db
              .select({
                status: schema.publishers.status,
                importNotificationPlan: schema.publishers.importNotificationPlan,
              })
              .from(schema.publishers)
              .where(eq(schema.publishers.id, existing.publisherId))
              .limit(1)
          : [];
        const editedPlan =
          existing.origin === 'imported' && nextStatus === 'published' && publisher
            ? importPlanToSchedule({
                publisherStatus: publisher.status,
                planId: publisher.importNotificationPlan,
              })
            : null;
        if (nextStatus === 'published' && existing.status !== 'published') {
          await approvePendingPushMessagesForEvent(db, eventId, at);
        }
        if (editedPlan && startsAt) {
          await scheduleImportPlanForEvent(db, {
            eventId,
            eventTitle: body.title ?? existing.title,
            startsAt: new Date(startsAt),
            eventStatus: 'published',
            planId: editedPlan,
            now: at,
          });
        } else if (existing.origin !== 'imported') {
          await upsertEventPushDraft(db, {
            eventId,
            eventTitle: body.title ?? existing.title,
            publisherStatus: publisher?.status ?? 'in_review',
            origin: existing.origin,
            now: at,
          });
        }
      }
      if (nextStatus === 'published' && existing.status !== 'published') {
        await enqueueDomainEvent(domainEvents, { type: 'event.published', eventId });
        await publishLinkedTip(eventId);
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
    async putPoster(eventId, body, contentType, actor) {
      const existing = await loadDetail(eventId);
      if (!existing) return null;
      const problem = posterImageError(contentType, body);
      if (problem) throw new AdminEventError(problem);
      if (!env.posterStore) throw new AdminEventError('poster_unavailable');
      const [previous] = await db
        .select({ s3Key: schema.eventImages.s3Key })
        .from(schema.eventImages)
        .where(
          and(
            eq(schema.eventImages.eventId, eventId),
            eq(schema.eventImages.role, POSTER_IMAGE_ROLE),
          ),
        )
        .limit(1);
      const key = `events/${eventId}/${POSTER_IMAGE_ROLE}/${randomUUID()}`;
      const type = contentType.split(';')[0]?.trim().toLowerCase() ?? contentType;
      await env.posterStore.put(key, body, type);
      const at = now();
      await db
        .insert(schema.eventImages)
        .values({
          eventId,
          role: POSTER_IMAGE_ROLE,
          s3Key: key,
          contentType: type,
          createdAt: at,
        })
        .onConflictDoUpdate({
          target: [schema.eventImages.eventId, schema.eventImages.role],
          set: { s3Key: key, contentType: type },
        });
      if (previous && previous.s3Key !== key) {
        await env.posterStore.delete(previous.s3Key);
      }
      if (existing.status === 'published') {
        await enqueueDomainEvent(domainEvents, {
          type: 'event.updated',
          eventId,
          changedFields: ['poster'],
        });
      }
      const updated = await loadDetail(eventId);
      await audit.write({
        actor,
        action: 'event.poster',
        entityType: 'event',
        entityId: eventId,
        before: { posterUrl: existing.posterUrl },
        after: { posterUrl: updated?.posterUrl ?? null },
      });
      return { posterUrl: updated?.posterUrl ?? null };
    },
    async deletePoster(eventId, actor) {
      const existing = await loadDetail(eventId);
      if (!existing) return null;
      const [image] = await db
        .select({ s3Key: schema.eventImages.s3Key })
        .from(schema.eventImages)
        .where(
          and(
            eq(schema.eventImages.eventId, eventId),
            eq(schema.eventImages.role, POSTER_IMAGE_ROLE),
          ),
        )
        .limit(1);
      if (image && env.posterStore) await env.posterStore.delete(image.s3Key);
      if (image) {
        await db
          .delete(schema.eventImages)
          .where(
            and(
              eq(schema.eventImages.eventId, eventId),
              eq(schema.eventImages.role, POSTER_IMAGE_ROLE),
            ),
          );
      }
      if (image && existing.status === 'published') {
        await enqueueDomainEvent(domainEvents, {
          type: 'event.updated',
          eventId,
          changedFields: ['poster'],
        });
      }
      await audit.write({
        actor,
        action: 'event.poster',
        entityType: 'event',
        entityId: eventId,
        before: { posterUrl: existing.posterUrl },
        after: { posterUrl: null },
      });
      return { posterUrl: null };
    },
  };
}
