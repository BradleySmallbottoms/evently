import type {
  Tag,
  CreateEventRequest,
  Event,
  ManagedEvent,
  OccasionListQuery,
  PublicEventListQuery,
  PublicEventListResponse,
  UpdateEventRequest,
} from '@local-events/contracts';
import type { DomainEventPublisher } from '../domain-events/types';

export type { DomainEventPublisher };

export type EventErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_event'
  | 'online_url_required'
  | 'cannot_edit'
  | 'cannot_publish'
  | 'cannot_cancel'
  | 'limit_reached'
  | 'check_in_disabled';

export class EventError extends Error {
  constructor(readonly code: EventErrorCode) {
    super(code);
    this.name = 'EventError';
  }
}

export type EventServices = {
  listTags: (query?: { upcoming?: boolean }) => Promise<Tag[]>;
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
  }) => Promise<Event | ManagedEvent>;
  updateEvent: (input: {
    sessionToken: string | undefined;
    eventId: string;
    body: UpdateEventRequest;
  }) => Promise<ManagedEvent>;
  publishEvent: (input: { sessionToken: string | undefined; eventId: string }) => Promise<Event>;
  cancelEvent: (input: { sessionToken: string | undefined; eventId: string }) => Promise<Event>;
  listPublicEvents: (query: PublicEventListQuery) => Promise<PublicEventListResponse>;
  /** Published events in one occasion group that have not ended, soonest first. */
  listOccasions: (query: OccasionListQuery) => Promise<Event[]>;
};

export type EventEnv = {
  now: () => Date;
  domainEvents?: DomainEventPublisher;
  /** Garage or CloudFront origin. Event image keys are appended to this. */
  assetsPublicBaseUrl?: string;
};
