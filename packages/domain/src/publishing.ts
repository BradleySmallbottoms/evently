import type { EventStatus } from './types';

export type SourceTrust = 'auto_publish' | 'review';

export type PublishInput =
  | { origin: 'native'; publisherVerified: boolean }
  | { origin: 'imported'; sourceTrust: SourceTrust; publisherIsTemporary: boolean };

/**
 * Status an event gets when it is published.
 * - Unverified native publishers: hidden, never pushed, until an admin verifies them.
 * - Imported events: per-source trust; a temporary (unmapped) publisher always means review.
 */
export function statusOnPublish(input: PublishInput): EventStatus {
  if (input.origin === 'native') {
    return input.publisherVerified ? 'published' : 'awaiting_verification';
  }
  if (input.publisherIsTemporary || input.sourceTrust === 'review') return 'in_review';
  return 'published';
}

/** Only published events are listed, searched and sent to the notification queue. */
export function shouldEnqueueNotifications(status: EventStatus): boolean {
  return status === 'published';
}

/** On publisher verification, upcoming hidden events are released; ended ones stay hidden. */
export function releaseOnVerification(
  event: { status: EventStatus; endsAt: Date },
  now: Date,
): EventStatus {
  if (event.status !== 'awaiting_verification') return event.status;
  return event.endsAt > now ? 'published' : 'awaiting_verification';
}
