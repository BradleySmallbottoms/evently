import { z } from 'zod';

const Id = z.uuid();

export const EventContentKind = z.enum(['map', 'schedule', 'info', 'file']);
export type EventContentKind = z.infer<typeof EventContentKind>;

export const EventContentVisibility = z.enum(['public', 'attendees']);
export type EventContentVisibility = z.infer<typeof EventContentVisibility>;

export const EventContentItem = z.object({
  id: Id,
  eventId: Id,
  kind: EventContentKind,
  title: z.string(),
  body: z.string().nullable(),
  visibility: EventContentVisibility,
  /** Short-lived signed URL when the item has a file; null for text-only items. */
  url: z.url().nullable(),
  urlExpiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type EventContentItem = z.infer<typeof EventContentItem>;

export const EventContentListResponse = z.object({
  items: z.array(EventContentItem),
  /** True when the caller has checked in (attendee-only rows included). */
  checkedIn: z.boolean(),
  /** Publisher text. Null until the caller has checked in on an event with check-in enabled. */
  attendeeText: z.string().nullable(),
  attendeeLinks: z.array(
    z.object({
      id: Id,
      url: z.url(),
      label: z.string().nullable(),
    }),
  ),
});
export type EventContentListResponse = z.infer<typeof EventContentListResponse>;

export const CreateEventContentRequest = z.object({
  kind: EventContentKind,
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(20_000).nullable().optional(),
  /** Private object key under the private files bucket (upload plumbing later). */
  s3Key: z.string().trim().min(1).max(512).nullable().optional(),
  visibility: EventContentVisibility.optional(),
});
export type CreateEventContentRequest = z.infer<typeof CreateEventContentRequest>;

export const UpdateEventContentRequest = z.object({
  kind: EventContentKind.optional(),
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().max(20_000).nullable().optional(),
  s3Key: z.string().trim().min(1).max(512).nullable().optional(),
  visibility: EventContentVisibility.optional(),
});
export type UpdateEventContentRequest = z.infer<typeof UpdateEventContentRequest>;
