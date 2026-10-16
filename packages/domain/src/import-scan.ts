import type { SourceTrust } from './publishing';
import type { EventStatus } from './types';

export type ImportScanStatus = Extract<EventStatus, 'in_review' | 'published'>;

/**
 * Status after the import scan finishes.
 * Published needs an approved scan, a verified publisher that is not temporary,
 * and an auto-publish source. A possible duplicate stays in review.
 */
export function statusAfterImportScan(input: {
  approved: boolean;
  publisherVerified: boolean;
  publisherIsTemporary: boolean;
  sourceTrust: SourceTrust;
  possibleDuplicate: boolean;
}): ImportScanStatus {
  if (
    input.possibleDuplicate ||
    !input.approved ||
    input.publisherIsTemporary ||
    !input.publisherVerified ||
    input.sourceTrust === 'review'
  ) {
    return 'in_review';
  }
  return 'published';
}
