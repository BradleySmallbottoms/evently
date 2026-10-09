import { DomainEvent as DomainEventSchema, type DomainEvent } from '@local-events/contracts';

/**
 * Domain events arrive from SQS. Each type has one handler; handlers must be idempotent
 * because SQS delivers at least once.
 */
export type { DomainEvent };

export type Handler<E extends DomainEvent = DomainEvent> = (event: E) => Promise<void>;

export const handlers: { [K in DomainEvent['type']]: Handler<Extract<DomainEvent, { type: K }>> } =
  {
    'event.published': async (e) => {
      // Thin slice: prove the pipe. Geo match + Expo send land in the next Phase 3 item.
      console.log(JSON.stringify({ received: e }));
    },
    'event.updated': async (_e) => {
      // TODO Phase 3: notify event subscribers on meaningful changes (debounced 10 min).
    },
    'checkin.created': async (_e) => {
      // TODO Phase 5: increment user/event/publisher stats.
    },
    'rating.created': async (_e) => {
      // TODO Phase 5: update rating aggregates.
    },
  };

export async function processMessage(body: string): Promise<DomainEvent['type']> {
  const event = DomainEventSchema.parse(JSON.parse(body));
  const handler = handlers[event.type] as Handler | undefined;
  if (!handler) throw new Error(`No handler for ${String((event as { type?: unknown }).type)}`);
  await handler(event);
  return event.type;
}
