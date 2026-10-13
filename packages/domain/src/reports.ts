import type { EventStatus } from './types';

/** People can only report a listing that is already public. */
export function canReportEvent(status: EventStatus): boolean {
  return status === 'published';
}
