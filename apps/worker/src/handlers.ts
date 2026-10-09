import { DomainEvent as DomainEventSchema, type DomainEvent } from '@local-events/contracts';
import type { HandlePublishedDeps } from './notify/handle-published';
import { handleEventPublished } from './notify/handle-published';

/**
 * Domain events arrive from SQS. Each type has one handler; handlers must be idempotent
 * because SQS delivers at least once.
 */
export type { DomainEvent };

export type HandlerContext = {
  notify?: HandlePublishedDeps;
};

export type Handler<E extends DomainEvent = DomainEvent> = (
  event: E,
  ctx: HandlerContext,
) => Promise<void>;

export const handlers: {
  [K in DomainEvent['type']]: Handler<Extract<DomainEvent, { type: K }>>;
} = {
  'event.published': async (e, ctx) => {
    if (!ctx.notify) {
      // Fail closed so SQS does not ack-and-forget when the worker has no DB.
      throw new Error('notify_unavailable');
    }
    const result = await handleEventPublished(e.eventId, ctx.notify);
    console.log(JSON.stringify({ handled: e.type, eventId: e.eventId, ...result }));
  },
  'event.updated': async (_e) => {
    // TODO: notify event subscribers on meaningful changes (debounced 10 min).
  },
  'checkin.created': async (_e) => {
    // TODO Phase 5: increment user/event/publisher stats.
  },
  'rating.created': async (_e) => {
    // TODO Phase 5: update rating aggregates.
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
