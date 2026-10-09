import type { DomainEvent } from '@local-events/contracts';
import type { DomainEventPublisher } from './types';

/** In-process publisher for tests and local runs without SQS. */
export function createMemoryDomainEventPublisher(
  sink: DomainEvent[] = [],
): DomainEventPublisher & { events: DomainEvent[] } {
  const events = sink;
  return {
    events,
    async publish(event) {
      events.push(event);
    },
  };
}
