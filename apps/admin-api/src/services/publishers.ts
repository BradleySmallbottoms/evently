import type {
  AdminCompletePublisherRequest,
  AdminCompletePublisherResponse,
  AdminMapPublisherResponse,
  AdminPublisherDeleteResponse,
  AdminPublisherEventListResponse,
  AdminPublisherListResponse,
  AdminPublisherPatchRequest,
  AdminTemporaryPublisherListResponse,
  ImportNotificationPlan,
  PublisherSummaryAdmin,
  VerifyPublisherResponse,
} from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { approveOpenPushMessagesForPublisher, schema } from '@local-events/db';
import {
  importNotificationMessages,
  canDeletePublisher,
  releaseOnVerification,
  shouldEnqueueNotifications,
  importPlanToSchedule,
  pushStatusForEvent,
  type MarketingPushPlanId,
  type PublisherStatus,
} from '@local-events/domain';
import { and, asc, count, desc, eq, ne } from 'drizzle-orm';
import { scheduleImportPlanForPublisher } from './import-notifications';
import { createMemoryDomainEventPublisher } from './domain-events/memory';
import { enqueueDomainEvent, type DomainEventPublisher } from './domain-events/types';

export type AdminPublisherServices = {
  listUnverified: () => Promise<AdminPublisherListResponse['items']>;
  listTemporary: () => Promise<AdminTemporaryPublisherListResponse['items']>;
  verify: (publisherId: string) => Promise<VerifyPublisherResponse | null>;
  mapTo: (input: {
    sourcePublisherId: string;
    targetPublisherId: string;
    adminId: string;
  }) => Promise<AdminMapPublisherResponse | null>;
  complete: (
    publisherId: string,
    body: AdminCompletePublisherRequest,
  ) => Promise<AdminCompletePublisherResponse | null>;
  patch: (
    publisherId: string,
    body: AdminPublisherPatchRequest,
  ) => Promise<PublisherSummaryAdmin | null>;
  get: (publisherId: string) => Promise<PublisherSummaryAdmin | null>;
  listAll: () => Promise<PublisherSummaryAdmin[]>;
  listEvents: (publisherId: string) => Promise<AdminPublisherEventListResponse | null>;
  remove: (
    publisherId: string,
  ) => Promise<
    | { ok: true; id: AdminPublisherDeleteResponse['id'] }
    | { ok: false; reason: 'not_found' | 'has_events' }
  >;
};

export type AdminPublisherEnv = {
  now?: () => Date;
  domainEvents?: DomainEventPublisher;
};

/** Minimal in-memory shape for admin tests (no dependency on apps/api). */
export type AdminMemoryStore = {
  publishers: Map<
    string,
    {
      id: string;
      name: string;
      slug: string;
      type: 'org' | 'person';
      status: PublisherStatus;
      origin: 'native' | 'imported';
      isTemporary?: boolean;
      importNotificationPlan?: ImportNotificationPlan | null;
      createdAt: Date;
    }
  >;
  events: Map<
    string,
    {
      id: string;
      publisherId: string;
      status: string;
      endsAtDate: Date;
      updatedAt: string;
      origin?: 'native' | 'imported';
      title?: string;
      startsAtDate?: Date;
      venueName?: string | null;
    }
  >;
  /** Reminders recorded when a verified publisher's import plan is applied. */
  scheduledImports?: {
    eventId: string;
    planId: string;
    offsets: string[];
    status: 'pending' | 'approved';
  }[];
  aliases?: Map<string, { sourceId: string; externalOrganizerKey: string; publisherId: string }>;
};

function asPublisherSummary(
  p: AdminMemoryStore['publishers'] extends Map<string, infer T> ? T : never,
): PublisherSummaryAdmin {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    type: p.type,
    status: p.status,
    origin: p.origin,
    importNotificationPlan: p.importNotificationPlan ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

const PUBLISHER_EVENT_LIST_LIMIT = 200;

function publisherEventRows(store: AdminMemoryStore, publisherId: string) {
  return [...store.events.values()]
    .filter((event) => event.publisherId === publisherId)
    .sort(
      (a, b) =>
        (b.startsAtDate ?? b.endsAtDate).getTime() - (a.startsAtDate ?? a.endsAtDate).getTime(),
    );
}

function scheduleMemoryImportPlanIfReady(
  store: AdminMemoryStore,
  publisherId: string,
  input: { publisherStatus: PublisherStatus; planId: MarketingPushPlanId | null },
  at: Date,
) {
  const planId = importPlanToSchedule(input);
  if (!planId) return;
  scheduleMemoryImportPlan(store, publisherId, planId, at);
}

function scheduleMemoryImportPlan(
  store: AdminMemoryStore,
  publisherId: string,
  planId: MarketingPushPlanId,
  now: Date,
) {
  const scheduled = store.scheduledImports ?? (store.scheduledImports = []);
  for (const event of store.events.values()) {
    if (event.publisherId !== publisherId) continue;
    if (event.origin !== 'imported') continue;
    if (event.status !== 'published' && event.status !== 'in_review') continue;
    if (!event.title || !event.startsAtDate) continue;
    if (scheduled.some((row) => row.eventId === event.id)) continue;
    const messages = importNotificationMessages({
      planId,
      eventTitle: event.title,
      startsAt: event.startsAtDate,
      now,
    });
    if (messages.length === 0) continue;
    scheduled.push({
      eventId: event.id,
      planId,
      offsets: messages.map((message) => message.offset),
      status: pushStatusForEvent(event.status),
    });
  }
}

export function createMemoryAdminPublisherServices(
  store: AdminMemoryStore,
  env: AdminPublisherEnv = {},
): AdminPublisherServices {
  const now = env.now ?? (() => new Date());
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();
  return {
    async listUnverified() {
      return [...store.publishers.values()]
        .filter((p) => p.status === 'in_review')
        .sort((a, b) => a.name.localeCompare(b.name, 'sv', { sensitivity: 'base' }))
        .map((p) => ({
          ...asPublisherSummary(p),
          eventCount: [...store.events.values()].filter((e) => e.publisherId === p.id).length,
        }));
    },
    async listTemporary() {
      return [...store.publishers.values()]
        .filter((p) => p.isTemporary)
        .sort((a, b) => a.name.localeCompare(b.name, 'sv', { sensitivity: 'base' }))
        .map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          type: p.type,
          origin: p.origin,
          eventCount: [...store.events.values()].filter((e) => e.publisherId === p.id).length,
          createdAt: p.createdAt.toISOString(),
        }));
    },
    async verify(publisherId: string) {
      const publisher = store.publishers.get(publisherId);
      if (!publisher) return null;
      publisher.status = 'published';
      const at = now();
      let releasedEventCount = 0;
      for (const row of store.events.values()) {
        if (row.publisherId !== publisherId) continue;
        const next = releaseOnVerification(
          { status: row.status as 'awaiting_verification', endsAt: row.endsAtDate },
          at,
        );
        if (next !== row.status) {
          row.status = next;
          row.updatedAt = at.toISOString();
          releasedEventCount += 1;
          if (shouldEnqueueNotifications(next)) {
            await enqueueDomainEvent(domainEvents, {
              type: 'event.published',
              eventId: row.id,
            });
          }
        }
      }
      scheduleMemoryImportPlanIfReady(
        store,
        publisherId,
        { publisherStatus: 'published', planId: publisher.importNotificationPlan ?? null },
        at,
      );
      return { id: publisherId, status: 'published' as const, releasedEventCount };
    },
    async mapTo({ sourcePublisherId, targetPublisherId }) {
      const source = store.publishers.get(sourcePublisherId);
      const target = store.publishers.get(targetPublisherId);
      if (!source?.isTemporary || !target || sourcePublisherId === targetPublisherId) return null;
      let movedEventCount = 0;
      for (const row of store.events.values()) {
        if (row.publisherId !== sourcePublisherId) continue;
        row.publisherId = targetPublisherId;
        movedEventCount += 1;
      }
      if (store.aliases) {
        const held = new Set(
          [...store.aliases.values()]
            .filter((alias) => alias.publisherId === targetPublisherId)
            .map((alias) => `${alias.sourceId}:${alias.externalOrganizerKey}`),
        );
        for (const [id, alias] of store.aliases) {
          if (alias.publisherId !== sourcePublisherId) continue;
          if (held.has(`${alias.sourceId}:${alias.externalOrganizerKey}`)) {
            store.aliases.delete(id);
            continue;
          }
          alias.publisherId = targetPublisherId;
        }
      }
      store.publishers.delete(sourcePublisherId);
      scheduleMemoryImportPlanIfReady(
        store,
        targetPublisherId,
        { publisherStatus: target.status, planId: target.importNotificationPlan ?? null },
        now(),
      );
      return { id: sourcePublisherId, targetPublisherId, movedEventCount };
    },
    async complete(publisherId, body) {
      const publisher = store.publishers.get(publisherId);
      if (!publisher?.isTemporary) return null;
      if (
        [...store.publishers.values()].some((p) => p.slug === body.slug && p.id !== publisherId)
      ) {
        return null;
      }
      publisher.name = body.name;
      publisher.slug = body.slug;
      publisher.type = body.type;
      publisher.isTemporary = false;
      return {
        id: publisherId,
        name: publisher.name,
        slug: publisher.slug,
        type: publisher.type,
        isTemporary: false as const,
      };
    },
    async listAll() {
      return [...store.publishers.values()]
        .sort((a, b) => a.name.localeCompare(b.name, 'sv', { sensitivity: 'base' }))
        .map(asPublisherSummary);
    },
    async get(publisherId) {
      const publisher = store.publishers.get(publisherId);
      return publisher ? asPublisherSummary(publisher) : null;
    },
    async patch(publisherId, body) {
      const publisher = store.publishers.get(publisherId);
      if (!publisher) return null;
      if (
        body.slug &&
        [...store.publishers.values()].some((p) => p.slug === body.slug && p.id !== publisherId)
      ) {
        return null;
      }
      if (body.name !== undefined) publisher.name = body.name;
      if (body.slug !== undefined) publisher.slug = body.slug;
      if (body.type !== undefined) publisher.type = body.type;
      if (body.importNotificationPlan !== undefined) {
        publisher.importNotificationPlan = body.importNotificationPlan;
      }
      if (body.importNotificationPlan) {
        scheduleMemoryImportPlanIfReady(
          store,
          publisherId,
          { publisherStatus: publisher.status, planId: publisher.importNotificationPlan ?? null },
          now(),
        );
      }
      return asPublisherSummary(publisher);
    },
    async listEvents(publisherId) {
      if (!store.publishers.has(publisherId)) return null;
      const rows = publisherEventRows(store, publisherId);
      const visible = rows.filter((event) => event.status !== 'deleted');
      return {
        total: rows.length,
        items: visible.slice(0, PUBLISHER_EVENT_LIST_LIMIT).map((event) => ({
          id: event.id,
          title: event.title ?? '',
          status: event.status as AdminPublisherEventListResponse['items'][number]['status'],
          startsAt: event.startsAtDate?.toISOString() ?? null,
          endsAt: event.endsAtDate?.toISOString() ?? null,
          venueName: event.venueName ?? null,
        })),
      };
    },
    async remove(publisherId) {
      if (!store.publishers.has(publisherId)) return { ok: false, reason: 'not_found' };
      if (!canDeletePublisher(publisherEventRows(store, publisherId).length)) {
        return { ok: false, reason: 'has_events' };
      }
      if (store.aliases) {
        for (const [id, alias] of store.aliases) {
          if (alias.publisherId === publisherId) store.aliases.delete(id);
        }
      }
      store.publishers.delete(publisherId);
      return { ok: true, id: publisherId };
    },
  };
}

export function createDbAdminPublisherServices(
  db: Db,
  env: AdminPublisherEnv = {},
): AdminPublisherServices {
  const now = env.now ?? (() => new Date());
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();
  return {
    async listUnverified() {
      const rows = await db
        .select({
          id: schema.publishers.id,
          name: schema.publishers.name,
          slug: schema.publishers.slug,
          type: schema.publishers.type,
          status: schema.publishers.status,
          origin: schema.publishers.origin,
          importNotificationPlan: schema.publishers.importNotificationPlan,
          createdAt: schema.publishers.createdAt,
          eventCount: count(schema.events.id),
        })
        .from(schema.publishers)
        .leftJoin(schema.events, eq(schema.events.publisherId, schema.publishers.id))
        .where(eq(schema.publishers.status, 'in_review'))
        .groupBy(
          schema.publishers.id,
          schema.publishers.name,
          schema.publishers.slug,
          schema.publishers.type,
          schema.publishers.status,
          schema.publishers.origin,
          schema.publishers.importNotificationPlan,
          schema.publishers.createdAt,
        )
        .orderBy(asc(schema.publishers.name));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        type: r.type,
        status: r.status,
        origin: r.origin,
        importNotificationPlan: r.importNotificationPlan,
        eventCount: Number(r.eventCount),
        createdAt: r.createdAt.toISOString(),
      }));
    },
    async listTemporary() {
      const rows = await db
        .select({
          id: schema.publishers.id,
          name: schema.publishers.name,
          slug: schema.publishers.slug,
          type: schema.publishers.type,
          origin: schema.publishers.origin,
          createdAt: schema.publishers.createdAt,
          eventCount: count(schema.events.id),
        })
        .from(schema.publishers)
        .leftJoin(schema.events, eq(schema.events.publisherId, schema.publishers.id))
        .where(eq(schema.publishers.isTemporary, true))
        .groupBy(
          schema.publishers.id,
          schema.publishers.name,
          schema.publishers.slug,
          schema.publishers.type,
          schema.publishers.origin,
          schema.publishers.createdAt,
        )
        .orderBy(asc(schema.publishers.name));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        type: r.type,
        origin: r.origin,
        eventCount: Number(r.eventCount),
        createdAt: r.createdAt.toISOString(),
      }));
    },
    async verify(publisherId: string) {
      const [publisher] = await db
        .select({
          id: schema.publishers.id,
          importNotificationPlan: schema.publishers.importNotificationPlan,
        })
        .from(schema.publishers)
        .where(eq(schema.publishers.id, publisherId))
        .limit(1);
      if (!publisher) return null;

      const at = now();
      await db
        .update(schema.publishers)
        .set({ status: 'published' })
        .where(eq(schema.publishers.id, publisherId));

      const awaiting = await db
        .select({
          id: schema.events.id,
          status: schema.events.status,
          endsAt: schema.events.endsAt,
        })
        .from(schema.events)
        .where(
          and(
            eq(schema.events.publisherId, publisherId),
            eq(schema.events.status, 'awaiting_verification'),
          ),
        );

      let releasedEventCount = 0;
      for (const row of awaiting) {
        if (!row.endsAt) continue;
        const next = releaseOnVerification({ status: row.status, endsAt: row.endsAt }, at);
        if (next !== row.status) {
          await db
            .update(schema.events)
            .set({ status: next, updatedAt: at })
            .where(eq(schema.events.id, row.id));
          releasedEventCount += 1;
          if (shouldEnqueueNotifications(next)) {
            await enqueueDomainEvent(domainEvents, {
              type: 'event.published',
              eventId: row.id,
            });
          }
        }
      }
      await approveOpenPushMessagesForPublisher(db, publisherId, at);
      const verifiedPlan = importPlanToSchedule({
        publisherStatus: 'published',
        planId: publisher.importNotificationPlan,
      });
      if (verifiedPlan) {
        await scheduleImportPlanForPublisher(db, publisherId, verifiedPlan, at);
      }

      return { id: publisherId, status: 'published' as const, releasedEventCount };
    },
    async mapTo({ sourcePublisherId, targetPublisherId, adminId }) {
      if (sourcePublisherId === targetPublisherId) return null;
      const [source] = await db
        .select({
          id: schema.publishers.id,
          isTemporary: schema.publishers.isTemporary,
        })
        .from(schema.publishers)
        .where(eq(schema.publishers.id, sourcePublisherId))
        .limit(1);
      const [target] = await db
        .select({
          id: schema.publishers.id,
          status: schema.publishers.status,
          importNotificationPlan: schema.publishers.importNotificationPlan,
        })
        .from(schema.publishers)
        .where(eq(schema.publishers.id, targetPublisherId))
        .limit(1);
      if (!source?.isTemporary || !target) return null;

      const at = now();
      const moved = await db
        .update(schema.events)
        .set({ publisherId: targetPublisherId, updatedAt: at })
        .where(eq(schema.events.publisherId, sourcePublisherId))
        .returning({ id: schema.events.id });

      const [sourceAliases, targetAliases] = await Promise.all([
        db
          .select({
            sourceId: schema.publisherAliases.sourceId,
            externalOrganizerKey: schema.publisherAliases.externalOrganizerKey,
          })
          .from(schema.publisherAliases)
          .where(eq(schema.publisherAliases.publisherId, sourcePublisherId)),
        db
          .select({
            sourceId: schema.publisherAliases.sourceId,
            externalOrganizerKey: schema.publisherAliases.externalOrganizerKey,
          })
          .from(schema.publisherAliases)
          .where(eq(schema.publisherAliases.publisherId, targetPublisherId)),
      ]);
      const held = new Set(
        targetAliases.map((alias) => `${alias.sourceId}:${alias.externalOrganizerKey}`),
      );
      for (const alias of sourceAliases) {
        if (!held.has(`${alias.sourceId}:${alias.externalOrganizerKey}`)) continue;
        await db
          .delete(schema.publisherAliases)
          .where(
            and(
              eq(schema.publisherAliases.publisherId, sourcePublisherId),
              eq(schema.publisherAliases.sourceId, alias.sourceId),
              eq(schema.publisherAliases.externalOrganizerKey, alias.externalOrganizerKey),
            ),
          );
      }

      await db
        .update(schema.publisherAliases)
        .set({ publisherId: targetPublisherId, mappedBy: adminId, mappedAt: at })
        .where(eq(schema.publisherAliases.publisherId, sourcePublisherId));

      await db.delete(schema.publishers).where(eq(schema.publishers.id, sourcePublisherId));

      const mappedPlan = importPlanToSchedule({
        publisherStatus: target.status,
        planId: target.importNotificationPlan,
      });
      if (mappedPlan) {
        await scheduleImportPlanForPublisher(db, targetPublisherId, mappedPlan, at);
      }

      return {
        id: sourcePublisherId,
        targetPublisherId,
        movedEventCount: moved.length,
      };
    },
    async complete(publisherId, body) {
      const [publisher] = await db
        .select({
          id: schema.publishers.id,
          isTemporary: schema.publishers.isTemporary,
        })
        .from(schema.publishers)
        .where(eq(schema.publishers.id, publisherId))
        .limit(1);
      if (!publisher?.isTemporary) return null;

      const [slugTaken] = await db
        .select({ id: schema.publishers.id })
        .from(schema.publishers)
        .where(and(eq(schema.publishers.slug, body.slug), ne(schema.publishers.id, publisherId)))
        .limit(1);
      if (slugTaken) return null;

      const [updated] = await db
        .update(schema.publishers)
        .set({
          name: body.name,
          slug: body.slug,
          type: body.type,
          isTemporary: false,
        })
        .where(and(eq(schema.publishers.id, publisherId), eq(schema.publishers.isTemporary, true)))
        .returning({
          id: schema.publishers.id,
          name: schema.publishers.name,
          slug: schema.publishers.slug,
          type: schema.publishers.type,
        });
      if (!updated) return null;
      return { ...updated, isTemporary: false as const };
    },
    async listAll() {
      const rows = await db
        .select({
          id: schema.publishers.id,
          name: schema.publishers.name,
          slug: schema.publishers.slug,
          type: schema.publishers.type,
          status: schema.publishers.status,
          origin: schema.publishers.origin,
          importNotificationPlan: schema.publishers.importNotificationPlan,
          createdAt: schema.publishers.createdAt,
        })
        .from(schema.publishers)
        .orderBy(asc(schema.publishers.name))
        .limit(200);
      return rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      }));
    },
    async get(publisherId) {
      const [row] = await db
        .select({
          id: schema.publishers.id,
          name: schema.publishers.name,
          slug: schema.publishers.slug,
          type: schema.publishers.type,
          status: schema.publishers.status,
          origin: schema.publishers.origin,
          importNotificationPlan: schema.publishers.importNotificationPlan,
          createdAt: schema.publishers.createdAt,
        })
        .from(schema.publishers)
        .where(eq(schema.publishers.id, publisherId))
        .limit(1);
      return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
    },
    async patch(publisherId, body) {
      const [existing] = await db
        .select({ id: schema.publishers.id })
        .from(schema.publishers)
        .where(eq(schema.publishers.id, publisherId))
        .limit(1);
      if (!existing) return null;
      if (body.slug) {
        const [taken] = await db
          .select({ id: schema.publishers.id })
          .from(schema.publishers)
          .where(and(eq(schema.publishers.slug, body.slug), ne(schema.publishers.id, publisherId)))
          .limit(1);
        if (taken) return null;
      }
      const [updated] = await db
        .update(schema.publishers)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.importNotificationPlan !== undefined
            ? { importNotificationPlan: body.importNotificationPlan }
            : {}),
        })
        .where(eq(schema.publishers.id, publisherId))
        .returning({
          id: schema.publishers.id,
          name: schema.publishers.name,
          slug: schema.publishers.slug,
          type: schema.publishers.type,
          status: schema.publishers.status,
          origin: schema.publishers.origin,
          importNotificationPlan: schema.publishers.importNotificationPlan,
          createdAt: schema.publishers.createdAt,
        });
      const savedPlan =
        updated && body.importNotificationPlan
          ? importPlanToSchedule({
              publisherStatus: updated.status,
              planId: updated.importNotificationPlan,
            })
          : null;
      if (savedPlan) {
        await scheduleImportPlanForPublisher(db, publisherId, savedPlan, now());
      }
      return updated ? { ...updated, createdAt: updated.createdAt.toISOString() } : null;
    },
    async listEvents(publisherId) {
      const [publisher] = await db
        .select({ id: schema.publishers.id })
        .from(schema.publishers)
        .where(eq(schema.publishers.id, publisherId))
        .limit(1);
      if (!publisher) return null;
      const [counted] = await db
        .select({ total: count() })
        .from(schema.events)
        .where(eq(schema.events.publisherId, publisherId));
      const rows = await db
        .select({
          id: schema.events.id,
          title: schema.events.title,
          status: schema.events.status,
          startsAt: schema.events.startsAt,
          endsAt: schema.events.endsAt,
          venueName: schema.events.venueName,
        })
        .from(schema.events)
        .where(and(eq(schema.events.publisherId, publisherId), ne(schema.events.status, 'deleted')))
        .orderBy(desc(schema.events.startsAt))
        .limit(PUBLISHER_EVENT_LIST_LIMIT);
      return {
        total: Number(counted?.total ?? 0),
        items: rows.map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          startsAt: row.startsAt?.toISOString() ?? null,
          endsAt: row.endsAt?.toISOString() ?? null,
          venueName: row.venueName,
        })),
      };
    },
    async remove(publisherId) {
      try {
        return await db.transaction(async (tx) => {
          const [publisher] = await tx
            .select({ id: schema.publishers.id })
            .from(schema.publishers)
            .where(eq(schema.publishers.id, publisherId))
            .limit(1);
          if (!publisher) return { ok: false as const, reason: 'not_found' as const };
          const [counted] = await tx
            .select({ total: count() })
            .from(schema.events)
            .where(eq(schema.events.publisherId, publisherId));
          if (!canDeletePublisher(Number(counted?.total ?? 0))) {
            return { ok: false as const, reason: 'has_events' as const };
          }
          await tx
            .delete(schema.publisherAliases)
            .where(eq(schema.publisherAliases.publisherId, publisherId));
          await tx
            .delete(schema.subscriptions)
            .where(
              and(
                eq(schema.subscriptions.targetType, 'publisher'),
                eq(schema.subscriptions.targetId, publisherId),
              ),
            );
          await tx.delete(schema.publishers).where(eq(schema.publishers.id, publisherId));
          return { ok: true as const, id: publisherId };
        });
      } catch (err) {
        if (isForeignKeyViolation(err)) return { ok: false, reason: 'has_events' };
        throw err;
      }
    },
  };
}

function isForeignKeyViolation(err: unknown): boolean {
  const code =
    (err as { code?: string; cause?: { code?: string } }).code ??
    (err as { cause?: { code?: string } }).cause?.code;
  return code === '23503';
}
