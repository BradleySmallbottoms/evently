import { z } from 'zod';

const Id = z.uuid();

export const NotificationPushState = z.enum(['pending', 'sent', 'aggregated']);
export type NotificationPushState = z.infer<typeof NotificationPushState>;

export const NotificationReason = z.enum(['nearby', 'publisher', 'event', 'broadcast', 'tip']);
export type NotificationReason = z.infer<typeof NotificationReason>;

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

export const UpdateQuietHoursRequest = z.object({
  enabled: z.boolean(),
  startMin: z.number().int().min(0).max(1439),
  endMin: z.number().int().min(0).max(1439),
});
export type UpdateQuietHoursRequest = z.infer<typeof UpdateQuietHoursRequest>;
