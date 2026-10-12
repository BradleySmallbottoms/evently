import { DomainEvent as DomainEventSchema, type DomainEvent } from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { eq } from 'drizzle-orm';
import type { HandleDuePushDeps } from './notify/handle-due-push';
import {
  applyCheckInStats,
  applyPublishedStats,
  applyRatingStats,
  type StatsWriter,
} from './stats/apply';

/**
 * Domain events arrive from SQS. Each type has one handler; handlers must be idempotent
 * because SQS delivers at least once. Stats use incremental adds — nightly reconcile
 * resets lifetime keys from source tables.
 * Push fan-out runs on a poll of approved `push_messages` (see handleDuePushMessages).
 */
export type { DomainEvent };

export type HandlerContext = {
  /** Used for inbox purge on publish and by the due-push poller. */
  notify?: HandleDuePushDeps;
  db?: Db;
  stats?: StatsWriter;
  now?: () => Date;
};

export type Handler<E extends DomainEvent = DomainEvent> = (
  event: E,
  ctx: HandlerContext,
) => Promise<void>;

async function publisherIdFor(db: Db, eventId: string): Promise<string | null> {
  const [row] = await db
    .select({ publisherId: schema.events.publisherId })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row?.publisherId ?? null;
}

export const handlers: {
  [K in DomainEvent['type']]: Handler<Extract<DomainEvent, { type: K }>>;
} = {
  'event.published': async (e, ctx) => {
    const now = ctx.now?.() ?? new Date();
    // Inbox purge runs on the due-push poller; keep publish handler stats-only.
    console.log(JSON.stringify({ handled: e.type, eventId: e.eventId }));

    if (!ctx.stats) return;
    const db = ctx.db ?? ctx.notify?.db;
    if (!db) return;
    const publisherId = await publisherIdFor(db, e.eventId);
    if (publisherId) {
      await applyPublishedStats(ctx.stats, publisherId, now);
    }
  },
  'event.updated': async (_e) => {
    // TODO: notify event subscribers on meaningful changes (debounced 10 min).
  },
  'checkin.created': async (e, ctx) => {
    if (!ctx.stats || !ctx.db) throw new Error('stats_unavailable');
    const publisherId = await publisherIdFor(ctx.db, e.eventId);
    if (!publisherId) return;
    await applyCheckInStats(
      ctx.stats,
      { eventId: e.eventId, userId: e.userId, publisherId },
      ctx.now?.() ?? new Date(),
    );
    console.log(JSON.stringify({ handled: e.type, eventId: e.eventId, userId: e.userId }));
  },
  'rating.created': async (e, ctx) => {
    if (!ctx.stats || !ctx.db) throw new Error('stats_unavailable');
    const publisherId = await publisherIdFor(ctx.db, e.eventId);
    if (!publisherId) return;
    await applyRatingStats(
      ctx.stats,
      {
        eventId: e.eventId,
        userId: e.userId,
        publisherId,
        score: e.score,
      },
      ctx.now?.() ?? new Date(),
    );
    console.log(JSON.stringify({ handled: e.type, eventId: e.eventId, userId: e.userId }));
  },
};

export async function processMessage(
  body: string,
  ctx: HandlerContext = {},
): Promise<DomainEvent['type']> {
  const event = DomainEventSchema.parse(JSON.parse(body));
  const handler = handlers[event.type] as Handler | undefined;
  if (!handler) throw new Error(`No handler for ${String((event as { type?: unknown }).type)}`);
  await handler(event, ctx);
  return event.type;
}
