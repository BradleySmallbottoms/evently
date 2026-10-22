// Mirrors contracts enums; kept local so domain has no zod dependency.
export type EventStatus =
  | 'draft'
  | 'awaiting_verification'
  | 'pending_scan'
  | 'in_review'
  | 'published'
  | 'cancelled'
  | 'ended'
  | 'deleted';

export type EventMode = 'physical' | 'digital';

/** Lookup and admin acceptance for a publisher. `published` is the accepted state. */
export type PublisherStatus = 'pending_scan' | 'in_review' | 'published';

export function publisherIsPublished(status: PublisherStatus): boolean {
  return status === 'published';
}
