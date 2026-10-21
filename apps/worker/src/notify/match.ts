import { NOTIFICATION_RETENTION_DAYS } from '@local-events/domain';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

export type MatchedUser = {
  userId: string;
};

export type PushDevice = {
  userId: string;
  deviceId: string;
  expoPushToken: string;
  locale: string;
};

export type PublishedEventForNotify = {
  id: string;
  title: string;
  status: string;
  publisherId: string;
  hasLocation: boolean;
  tagIds: string[];
};

export async function loadPublishedEvent(
  db: Db,
  eventId: string,
): Promise<PublishedEventForNotify | null> {
  const [row] = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      status: schema.events.status,
      publisherId: schema.events.publisherId,
      location: schema.events.location,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!row?.publisherId) return null;
  const cats = await db
    .select({ tagId: schema.eventTags.tagId })
    .from(schema.eventTags)
    .where(eq(schema.eventTags.eventId, eventId));
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    publisherId: row.publisherId,
    hasLocation: row.location != null,
    tagIds: cats.map((c) => c.tagId),
  };
}

/**
 * Users with an active notify area covering the event point, where that same
 * area has at least one tag in common with the event. Tags on another area do
 * not count. Push token is not required — inbox rows are stored either way.
 */
export async function findNearbyMatchedUsers(
  db: Db,
  eventId: string,
  limit = 500,
): Promise<MatchedUser[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT u.id AS user_id
    FROM events e
    INNER JOIN event_tags et ON et.event_id = e.id
    INNER JOIN user_areas ua
      ON ua.active = true
      AND ua.notify = true
      AND (
        (ua.area IS NOT NULL AND ST_Covers(ua.area, e.location))
        OR (
          ua.center IS NOT NULL
          AND ua.radius_m IS NOT NULL
          AND ST_DWithin(ua.center, e.location, ua.radius_m)
        )
      )
    INNER JOIN user_area_tags uat
      ON uat.area_id = ua.id
      AND uat.tag_id = et.tag_id
    INNER JOIN users u ON u.id = ua.user_id
    WHERE e.id = ${eventId}::uuid
      AND e.status = 'published'
      AND e.location IS NOT NULL
    LIMIT ${limit}
  `);

  const list = (Array.isArray(rows) ? rows : []) as Array<{ user_id: string }>;
  return list.map((r) => ({ userId: r.user_id }));
}

/**
 * Users with an active notify area covering the event point.
 * Interests are not required. Push token is not required.
 */
export async function findAreaMatchedUsers(
  db: Db,
  eventId: string,
  limit = 500,
): Promise<MatchedUser[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT u.id AS user_id
    FROM events e
    INNER JOIN user_areas ua
      ON ua.active = true
      AND ua.notify = true
      AND (
        (ua.area IS NOT NULL AND ST_Covers(ua.area, e.location))
        OR (
          ua.center IS NOT NULL
          AND ua.radius_m IS NOT NULL
          AND ST_DWithin(ua.center, e.location, ua.radius_m)
        )
      )
    INNER JOIN users u ON u.id = ua.user_id
    WHERE e.id = ${eventId}::uuid
      AND e.status = 'published'
      AND e.location IS NOT NULL
    LIMIT ${limit}
  `);

  const list = (Array.isArray(rows) ? rows : []) as Array<{ user_id: string }>;
  return list.map((r) => ({ userId: r.user_id }));
}

/** Drizzle transaction or root db — both support the query builders we use. */
export type NotifyDb = Pick<Db, 'insert' | 'delete' | 'update' | 'select' | 'execute'>;

/** Publisher followers (no geo/interest filter). Inbox without requiring a push token. */
export async function findPublisherSubscriberUsers(
  db: Db,
  publisherId: string,
  limit = 500,
): Promise<MatchedUser[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT u.id AS user_id
    FROM subscriptions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.target_type = 'publisher'
      AND s.target_id = ${publisherId}::uuid
    LIMIT ${limit}
  `);

  const list = (Array.isArray(rows) ? rows : []) as Array<{ user_id: string }>;
  return list.map((r) => ({ userId: r.user_id }));
}

export async function loadPushDevicesForUsers(
  db: NotifyDb,
  userIds: string[],
): Promise<PushDevice[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({
      userId: schema.devices.userId,
      deviceId: schema.devices.id,
      expoPushToken: schema.devices.expoPushToken,
      locale: schema.devices.locale,
    })
    .from(schema.devices)
    .where(
      and(
        inArray(schema.devices.userId, userIds),
        isNull(schema.devices.revokedAt),
        sql`${schema.devices.expoPushToken} IS NOT NULL`,
      ),
    );

  return rows
    .filter((r): r is typeof r & { expoPushToken: string } => r.expoPushToken != null)
    .map((r) => ({
      userId: r.userId,
      deviceId: r.deviceId,
      expoPushToken: r.expoPushToken,
      locale: r.locale,
    }));
}

export async function claimNotification(
  db: NotifyDb,
  input: { userId: string; eventId: string; reason: 'nearby' | 'publisher'; now: Date },
): Promise<string | null> {
  const inserted = await db
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      eventId: input.eventId,
      reason: input.reason,
      sentAt: input.now,
      pushState: 'pending',
    })
    .onConflictDoNothing()
    .returning({ id: schema.notifications.id });
  return inserted[0]?.id ?? null;
}

export async function markNotificationsPushed(
  db: NotifyDb,
  notificationIds: string[],
  now: Date,
): Promise<void> {
  if (notificationIds.length === 0) return;
  await db
    .update(schema.notifications)
    .set({ pushState: 'sent', pushedAt: now })
    .where(inArray(schema.notifications.id, notificationIds));
}

/** Clear stale Expo tokens after DeviceNotRegistered-style errors. */
export async function clearExpoPushToken(db: NotifyDb, deviceId: string): Promise<void> {
  await db
    .update(schema.devices)
    .set({ expoPushToken: null })
    .where(eq(schema.devices.id, deviceId));
}

export async function countUnreadNotifications(db: NotifyDb, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return Number(row?.count ?? 0);
}

/**
 * Hard-delete inbox rows older than retention. Batched to avoid long locks.
 * Returns total rows deleted.
 */
export async function purgeExpiredNotifications(
  db: NotifyDb,
  now: Date,
  retentionDays: number = NOTIFICATION_RETENTION_DAYS,
  batchSize = 1_000,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  let total = 0;
  for (;;) {
    const old = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(lt(schema.notifications.sentAt, cutoff))
      .limit(batchSize);
    if (old.length === 0) break;
    const ids = old.map((r) => r.id);
    await db.delete(schema.notifications).where(inArray(schema.notifications.id, ids));
    total += ids.length;
    if (old.length < batchSize) break;
  }
  return total;
}
