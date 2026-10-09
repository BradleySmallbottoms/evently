import type {
  Category,
  CreateEventRequest,
  Event,
  PublicEventListQuery,
  UpdateEventRequest,
} from '@local-events/contracts';
import type { DomainEventPublisher } from '../domain-events/types';

export type { DomainEventPublisher };

export type EventErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_event'
  | 'location_required'
  | 'online_url_required'
  | 'cannot_edit'
  | 'cannot_publish'
  | 'cannot_cancel'
  | 'limit_reached';

export class EventError extends Error {
  constructor(readonly code: EventErrorCode) {
    super(code);
    this.name = 'EventError';
  }
}

export type EventServices = {
  listCategories: () => Promise<Category[]>;
  listPublisherEvents: (input: {
    sessionToken: string | undefined;
    publisherId: string;
  }) => Promise<Event[]>;
  createEvent: (input: {
    sessionToken: string | undefined;
    publisherId: string;
    body: CreateEventRequest;
  }) => Promise<Event>;
  getEvent: (input: {
    sessionToken: string | undefined;
    eventId: string;
    /** When true, only published events are returned (public surface). */
    publicOnly: boolean;
  }) => Promise<Event>;
  updateEvent: (input: {
    sessionToken: string | undefined;
    eventId: string;
    body: UpdateEventRequest;
  }) => Promise<Event>;
  publishEvent: (input: {
    sessionToken: string | undefined;
    eventId: string;
  }) => Promise<Event>;
  cancelEvent: (input: {
    sessionToken: string | undefined;
    eventId: string;
  }) => Promise<Event>;
  listPublicEvents: (query: PublicEventListQuery) => Promise<Event[]>;
};

export type EventEnv = {
  now: () => Date;
  domainEvents?: DomainEventPublisher;
};
