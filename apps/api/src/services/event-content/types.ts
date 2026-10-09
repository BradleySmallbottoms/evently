import type {
  CreateEventContentRequest,
  EventContentItem,
  EventContentListResponse,
  UpdateEventContentRequest,
} from '@local-events/contracts';

export type EventContentErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'check_in_required';

export class EventContentError extends Error {
  constructor(readonly code: EventContentErrorCode) {
    super(code);
    this.name = 'EventContentError';
  }
}

export type SignedContentUrl = {
  url: string;
  expiresAt: Date;
};

/** Mints short-lived URLs for private S3 keys (CloudFront/S3 in prod; memory in tests). */
export type ContentUrlSigner = {
  sign: (s3Key: string) => Promise<SignedContentUrl>;
};

export type EventContentEnv = {
  now?: () => Date;
  signer?: ContentUrlSigner;
};

export type EventContentServices = {
  /** Attendee/public list for a published event (Bearer optional for public-only). */
  listForEvent: (
    sessionToken: string | undefined,
    eventId: string,
  ) => Promise<EventContentListResponse>;
  listManaged: (
    publisherSessionToken: string | undefined,
    eventId: string,
  ) => Promise<{ items: EventContentItem[] }>;
  create: (
    publisherSessionToken: string | undefined,
    eventId: string,
    input: CreateEventContentRequest,
  ) => Promise<EventContentItem>;
  update: (
    publisherSessionToken: string | undefined,
    contentId: string,
    input: UpdateEventContentRequest,
  ) => Promise<EventContentItem>;
  remove: (publisherSessionToken: string | undefined, contentId: string) => Promise<void>;
};
