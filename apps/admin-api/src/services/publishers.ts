import type {
  AdminPublisherListResponse,
  VerifyPublisherResponse,
} from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { releaseOnVerification, shouldEnqueueNotifications } from '@local-events/domain';
import { and, eq } from 'drizzle-orm';
import { createMemoryDomainEventPublisher } from './domain-events/memory';
import { enqueueDomainEvent, type DomainEventPublisher } from './domain-events/types';

export type AdminPublisherServices = {
  listUnverified: () => Promise<AdminPublisherListResponse['items']>;
  verify: (publisherId: string) => Promise<VerifyPublisherResponse | null>;
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

      return { id: publisherId, verified: true as const, releasedEventCount };
    },
  };
}
