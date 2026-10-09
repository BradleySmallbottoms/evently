import type { DomainEvent } from '@local-events/contracts';

export type DomainEventPublisher = {
  publish: (event: DomainEvent) => Promise<void>;
};

/** Best-effort enqueue after a durable write; never fail the primary mutation. */
export async function enqueueDomainEvent(
  publisher: DomainEventPublisher,
  event: DomainEvent,
): Promise<void> {
  try {
    await publisher.publish(event);
  } catch (err) {
    console.error('domain event enqueue failed', { type: event.type, err });
  }
}
