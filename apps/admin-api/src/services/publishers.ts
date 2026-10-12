import type {
  AdminCompletePublisherRequest,
  AdminCompletePublisherResponse,
  AdminMapPublisherResponse,
  AdminPublisherListResponse,
  AdminPublisherPatchRequest,
  AdminTemporaryPublisherListResponse,
  PublisherSummaryAdmin,
  VerifyPublisherResponse,
} from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { approveOpenPushMessagesForPublisher, schema } from '@local-events/db';
import { releaseOnVerification, shouldEnqueueNotifications } from '@local-events/domain';
import { and, count, eq, ne, asc } from 'drizzle-orm';
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
  listAll: () => Promise<PublisherSummaryAdmin[]>;
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
      verified: boolean;
      origin: 'native' | 'imported';
      isTemporary?: boolean;
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
    }
  >;
  aliases?: Map<
    string,
    { sourceId: string; externalOrganizerKey: string; publisherId: string }
  >;
};

export function createMemoryAdminPublisherServices(
  store: AdminMemoryStore,
  env: AdminPublisherEnv = {},
): AdminPublisherServices {
  const now = env.now ?? (() => new Date());
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();
  return {
    async listUnverified() {
      return [...store.publishers.values()]
        .filter((p) => !p.verified)
        .map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          type: p.type,
          verified: p.verified,
          origin: p.origin,
          createdAt: p.createdAt.toISOString(),
        }));
    },
    async listTemporary() {
      return [...store.publishers.values()]
        .filter((p) => p.isTemporary)
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
      publisher.verified = true;
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
      return { id: publisherId, verified: true as const, releasedEventCount };
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
        for (const alias of store.aliases.values()) {
          if (alias.publisherId === sourcePublisherId) alias.publisherId = targetPublisherId;
        }
      }
      store.publishers.delete(sourcePublisherId);
      return { id: sourcePublisherId, targetPublisherId, movedEventCount };
    },
    async complete(publisherId, body) {
      const publisher = store.publishers.get(publisherId);
      if (!publisher?.isTemporary) return null;
      if ([...store.publishers.values()].some((p) => p.slug === body.slug && p.id !== publisherId)) {
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
      return [...store.publishers.values()].map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        type: p.type,
        verified: p.verified,
        origin: p.origin,
        createdAt: p.createdAt.toISOString(),
      }));
    },
    async patch(publisherId, body) {
      const publisher = store.publishers.get(publisherId);
      if (!publisher) return null;
      if (body.slug && [...store.publishers.values()].some((p) => p.slug === body.slug && p.id !== publisherId)) {
        return null;
      }
      if (body.name !== undefined) publisher.name = body.name;
      if (body.slug !== undefined) publisher.slug = body.slug;
      if (body.type !== undefined) publisher.type = body.type;
      return {
        id: publisher.id,
        name: publisher.name,
        slug: publisher.slug,
        type: publisher.type,
        verified: publisher.verified,
        origin: publisher.origin,
        createdAt: publisher.createdAt.toISOString(),
      };
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
          verified: schema.publishers.verified,
          origin: schema.publishers.origin,
          createdAt: schema.publishers.createdAt,
        })
        .from(schema.publishers)
        .where(eq(schema.publishers.verified, false));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        type: r.type,
        verified: r.verified,
        origin: r.origin,
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
        );
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
        .select({ id: schema.publishers.id })
        .from(schema.publishers)
        .where(eq(schema.publishers.id, publisherId))
        .limit(1);
      if (!publisher) return null;

      const at = now();
      await db
        .update(schema.publishers)
        .set({ verified: true })
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

      return { id: publisherId, verified: true as const, releasedEventCount };
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
        .select({ id: schema.publishers.id })
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

      await db
        .update(schema.publisherAliases)
        .set({ publisherId: targetPublisherId, mappedBy: adminId, mappedAt: at })
        .where(eq(schema.publisherAliases.publisherId, sourcePublisherId));

      await db.delete(schema.publishers).where(eq(schema.publishers.id, sourcePublisherId));

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
          verified: schema.publishers.verified,
          origin: schema.publishers.origin,
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
        })
        .where(eq(schema.publishers.id, publisherId))
        .returning({
          id: schema.publishers.id,
          name: schema.publishers.name,
          slug: schema.publishers.slug,
          type: schema.publishers.type,
          verified: schema.publishers.verified,
          origin: schema.publishers.origin,
          createdAt: schema.publishers.createdAt,
        });
      return updated
        ? { ...updated, createdAt: updated.createdAt.toISOString() }
        : null;
    },
  };
}
