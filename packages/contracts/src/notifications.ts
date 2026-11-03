import { z } from 'zod';

const Id = z.uuid();

export const NotificationPushState = z.enum(['pending', 'sent', 'aggregated']);
export type NotificationPushState = z.infer<typeof NotificationPushState>;

export const NotificationReason = z.enum(['nearby', 'publisher', 'event', 'broadcast', 'tip']);
export type NotificationReason = z.infer<typeof NotificationReason>;

/** Tip notice state copied from the push message. Null for other inbox rows. */
export const NotificationTipStatus = z.enum(['published', 'in_review', 'failed', 'needs_input']);
export type NotificationTipStatus = z.infer<typeof NotificationTipStatus>;

export const NotificationItem = z.object({
  id: Id,
  /** Null for admin broadcasts with no linked event. */
  eventId: Id.nullable(),
  eventTitle: z.string(),
  reason: NotificationReason,
  pushState: NotificationPushState,
  createdAt: z.iso.datetime(),
  pushedAt: z.iso.datetime().nullable(),
  readAt: z.iso.datetime().nullable(),
  /** Push headline and body. Null when the inbox row has no message. */
  titleSv: z.string().nullable(),
  titleEn: z.string().nullable(),
  bodySv: z.string().nullable(),
  bodyEn: z.string().nullable(),
  tipStatus: NotificationTipStatus.nullable(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

export const NotificationListResponse = z.object({
  items: z.array(NotificationItem),
  /** Unread inbox rows (read_at IS NULL) for the notifications-button badge. */
  unreadCount: z.number().int().nonnegative(),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponse>;

export const QuietHoursPrefs = z.object({
  enabled: z.boolean(),
  /** Minutes from local midnight [0, 1440). */
  startMin: z.number().int().min(0).max(1439),
  endMin: z.number().int().min(0).max(1439),
  timezone: z.string().min(1).max(64),
});
export type QuietHoursPrefs = z.infer<typeof QuietHoursPrefs>;

export const UpdateNotificationReadRequest = z.object({
  read: z.boolean(),
});
export type UpdateNotificationReadRequest = z.infer<typeof UpdateNotificationReadRequest>;

/**
 * Inbox writes return this instead of an empty 204. iOS fetch rejects a body-less
 * 204, so the phone would show a failure after the row was already updated.
 */
export const NotificationAckResponse = z.object({
  ok: z.literal(true),
});
export type NotificationAckResponse = z.infer<typeof NotificationAckResponse>;

export const UpdateQuietHoursRequest = z.object({
  enabled: z.boolean(),
  startMin: z.number().int().min(0).max(1439),
  endMin: z.number().int().min(0).max(1439),
});
export type UpdateQuietHoursRequest = z.infer<typeof UpdateQuietHoursRequest>;
