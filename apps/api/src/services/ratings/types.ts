import type {
  CreateRatingRequest,
  PublisherRatingListResponse,
  Rating,
  RatingStatusResponse,
} from '@local-events/contracts';
import type { DomainEventPublisher } from '../domain-events/types';

export type RatingErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'not_eligible'
  | 'already_rated'
  | 'comment_not_allowed';

export class RatingError extends Error {
  constructor(readonly code: RatingErrorCode) {
    super(code);
    this.name = 'RatingError';
  }
}

export type RatingEnv = {
  now?: () => Date;
  domainEvents?: DomainEventPublisher;
};

export type RatingServices = {
  getStatus: (
    sessionToken: string | undefined,
    eventId: string,
  ) => Promise<RatingStatusResponse>;
  create: (
    sessionToken: string | undefined,
    eventId: string,
    input: CreateRatingRequest,
  ) => Promise<Rating>;
  listManaged: (
    publisherSessionToken: string | undefined,
    eventId: string,
  ) => Promise<PublisherRatingListResponse>;
};
