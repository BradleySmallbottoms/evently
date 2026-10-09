// Mirrors contracts enums; kept local so domain has no zod dependency.
export type EventStatus =
  | 'draft'
  | 'awaiting_verification'
  | 'in_review'
  | 'published'
  | 'cancelled'
  | 'ended';

export type EventMode = 'physical' | 'digital';
