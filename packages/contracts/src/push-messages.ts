import { z } from 'zod';

const Id = z.uuid();

export const PushMessageStatus = z.enum([
  'pending',
  'approved',
  'sending',
  'sent',
  'rejected',
  'cancelled',
]);
export type PushMessageStatus = z.infer<typeof PushMessageStatus>;

export const PushMessageKind = z.enum(['event', 'broadcast']);
export type PushMessageKind = z.infer<typeof PushMessageKind>;

export const PushAudience = z.enum([
  'event_match',
  'everyone',
  'tag_interest',
  'area',
  'area_and_tag',
]);
export type PushAudience = z.infer<typeof PushAudience>;

export const PushMessage = z.object({
  id: Id,
  eventId: Id.nullable(),
  eventTitle: z.string().nullable(),
  publisherId: Id.nullable(),
  publisherName: z.string().nullable(),
  eventStatus: z.string().nullable(),
  kind: PushMessageKind,
  audience: PushAudience,
  audienceTagId: Id.nullable(),
  audienceTagName: z.string().nullable().optional(),
  status: PushMessageStatus,
  titleSv: z.string(),
  bodySv: z.string(),
  titleEn: z.string(),
  bodyEn: z.string(),
  sendAt: z.iso.datetime().nullable(),
  copyEdited: z.boolean(),
  approvedAt: z.iso.datetime().nullable(),
  approvedByAdminId: Id.nullable(),
  sentAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PushMessage = z.infer<typeof PushMessage>;

export const PushMessageListResponse = z.object({
  items: z.array(PushMessage),
});
export type PushMessageListResponse = z.infer<typeof PushMessageListResponse>;

/** A push that has been sent, or is still fanning out, for one event. */
export const SentEventNotification = z.object({
  id: Id,
  status: z.enum(['sending', 'sent']),
  audience: PushAudience,
  audienceTagName: z.string().nullable(),
  titleSv: z.string(),
  bodySv: z.string(),
  titleEn: z.string(),
  bodyEn: z.string(),
  sendAt: z.iso.datetime().nullable(),
  sentAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** Distinct users with an inbox row for this message. */
  recipientCount: z.number().int().nonnegative(),
});
export type SentEventNotification = z.infer<typeof SentEventNotification>;

export const SentEventNotificationListResponse = z.object({
  items: z.array(SentEventNotification),
});
export type SentEventNotificationListResponse = z.infer<typeof SentEventNotificationListResponse>;

export const UpdatePushMessageRequest = z.object({
  titleSv: z.string().min(1).max(200).optional(),
  bodySv: z.string().min(1).max(500).optional(),
  titleEn: z.string().min(1).max(200).optional(),
  bodyEn: z.string().min(1).max(500).optional(),
  /** ISO datetime or null to clear (send ASAP after approve). */
  sendAt: z.iso.datetime().nullable().optional(),
});
export type UpdatePushMessageRequest = z.infer<typeof UpdatePushMessageRequest>;

export const ApprovePushMessageRequest = z.object({
  sendAt: z.iso.datetime().nullable().optional(),
});
export type ApprovePushMessageRequest = z.infer<typeof ApprovePushMessageRequest>;

export const PushMessageAudience = z.object({
  nearby: z.number().int().nonnegative(),
  publisherFollowers: z.number().int().nonnegative(),
  uniqueRecipients: z.number().int().nonnegative(),
  withPushToken: z.number().int().nonnegative(),
  capped: z.boolean(),
  /** Nearby match requires event.status = published. */
  eventPublished: z.boolean(),
});
export type PushMessageAudience = z.infer<typeof PushMessageAudience>;

export const CreateEventPushMessageRequest = z.object({
  sendAt: z.iso.datetime().nullable().optional(),
  titleSv: z.string().min(1).max(200).optional(),
  bodySv: z.string().min(1).max(500).optional(),
  titleEn: z.string().min(1).max(200).optional(),
  bodyEn: z.string().min(1).max(500).optional(),
});
export type CreateEventPushMessageRequest = z.infer<typeof CreateEventPushMessageRequest>;

/** Admin starts a notification for a published event. Approved on create. */
export const CreateAdminEventPushMessageRequest = CreateEventPushMessageRequest.extend({
  eventId: Id,
  /** `area` = saved notify area covers the event. `area_and_tag` also requires a shared interest. */
  audience: z.enum(['area', 'area_and_tag']),
});
export type CreateAdminEventPushMessageRequest = z.infer<
  typeof CreateAdminEventPushMessageRequest
>;

export const CreateBroadcastPushMessageRequest = z
  .object({
    titleSv: z.string().min(1).max(200),
    bodySv: z.string().min(1).max(500),
    titleEn: z.string().min(1).max(200),
    bodyEn: z.string().min(1).max(500),
    audience: z.enum(['everyone', 'tag_interest']),
    audienceTagId: Id.optional(),
    /** Null / omit = send on next worker tick after create (auto-approved). */
    sendAt: z.iso.datetime().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.audience === 'tag_interest' && !val.audienceTagId) {
      ctx.addIssue({
        code: 'custom',
        message: 'audienceTagId required for tag_interest',
        path: ['audienceTagId'],
      });
    }
  });
export type CreateBroadcastPushMessageRequest = z.infer<typeof CreateBroadcastPushMessageRequest>;
