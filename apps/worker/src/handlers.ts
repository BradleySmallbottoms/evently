/**
 * Domain events arrive from SQS. Each type has one handler; handlers must be idempotent
 * because SQS delivers at least once.
 */
export type DomainEvent =
  | { type: 'event.published'; eventId: string }
  | { type: 'event.updated'; eventId: string; changedFields: string[] }
  | { type: 'checkin.created'; eventId: string; userId: string }
  | { type: 'rating.created'; eventId: string; userId: string };

export type Handler<E extends DomainEvent = DomainEvent> = (event: E) => Promise<void>;

export const handlers: { [K in DomainEvent['type']]: Handler<Extract<DomainEvent, { type: K }>> } =
  {
    'event.published': async (_e) => {
      // TODO Phase 3: geo match users (areas + regions + interests), merge publisher subscribers,
      // dedupe against notifications, apply caps/quiet hours, send via Expo Push.
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
  const event = JSON.parse(body) as DomainEvent;
  const handler = handlers[event.type] as Handler | undefined;
  if (!handler) throw new Error(`No handler for ${String((event as { type?: unknown }).type)}`);
  await handler(event);
  return event.type;
}
