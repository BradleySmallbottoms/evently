import type { DomainEvent } from '@local-events/contracts';
import type { DomainEventPublisher } from './types';

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
