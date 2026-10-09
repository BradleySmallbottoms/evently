import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

export type NearbyCandidate = {
  userId: string;
  deviceId: string;
  expoPushToken: string;
  locale: string;
  timezone: string;
  quietHoursStartMin: number;
  quietHoursEndMin: number;
  quietHoursEnabled: boolean;
};

export type PublishedEventForNotify = {
  id: string;
  title: string;
  status: string;
  publisherId: string;
  hasLocation: boolean;
  categoryIds: string[];
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
  if (!row) return null;
  const cats = await db
    .select({ categoryId: schema.eventCategories.categoryId })
    .from(schema.eventCategories)
    .where(eq(schema.eventCategories.eventId, eventId));
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    publisherId: row.publisherId,
    hasLocation: row.location != null,
    categoryIds: cats.map((c) => c.categoryId),
  };
}

/**
 * Users with an active notify area covering the event point, overlapping interests,
 * and at least one device with an Expo push token.
 */
export async function findNearbyCandidates(
  db: Db,
  eventId: string,
  limit = 500,
): Promise<NearbyCandidate[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT
      u.id AS user_id,
      d.id AS device_id,
      d.expo_push_token,
      d.locale,
      u.timezone,
      u.quiet_hours_start_min,
      u.quiet_hours_end_min,
      u.quiet_hours_enabled
    FROM events e
    INNER JOIN event_categories ec ON ec.event_id = e.id
    INNER JOIN user_interests ui ON ui.category_id = ec.category_id
    INNER JOIN users u ON u.id = ui.user_id
    INNER JOIN user_areas ua
      ON ua.user_id = u.id
      AND ua.active = true
      AND ua.notify = true
    INNER JOIN devices d
      ON d.user_id = u.id
      AND d.revoked_at IS NULL
      AND d.expo_push_token IS NOT NULL
    WHERE e.id = ${eventId}::uuid
      AND e.status = 'published'
      AND e.location IS NOT NULL
      AND (
        (ua.area IS NOT NULL AND ST_Covers(ua.area, e.location))
        OR (
          ua.center IS NOT NULL
          AND ua.radius_m IS NOT NULL
          AND ST_DWithin(ua.center, e.location, ua.radius_m)
        )
      )
    LIMIT ${limit}
  `);

  const list = (Array.isArray(rows) ? rows : []) as Array<{
    user_id: string;
    device_id: string;
    expo_push_token: string;
    locale: string;
    timezone: string;
    quiet_hours_start_min: number;
    quiet_hours_end_min: number;
    quiet_hours_enabled: boolean;
  }>;

  return list.map((r) => ({
    userId: r.user_id,
    deviceId: r.device_id,
    expoPushToken: r.expo_push_token,
    locale: r.locale,
    timezone: r.timezone,
    quietHoursStartMin: Number(r.quiet_hours_start_min),
    quietHoursEndMin: Number(r.quiet_hours_end_min),
    quietHoursEnabled: Boolean(r.quiet_hours_enabled),
  }));
}

/** Drizzle transaction or root db — both support the query builders we use. */
export type NotifyDb = Pick<Db, 'insert' | 'delete' | 'update' | 'select' | 'execute'>;

/** Publisher followers with a push-capable device (no geo/interest filter). */
export async function findPublisherSubscriberCandidates(
  db: Db,
  publisherId: string,
  limit = 500,
): Promise<NearbyCandidate[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT
      u.id AS user_id,
      d.id AS device_id,
      d.expo_push_token,
      d.locale,
      u.timezone,
      u.quiet_hours_start_min,
      u.quiet_hours_end_min,
      u.quiet_hours_enabled
    FROM subscriptions s
    INNER JOIN users u ON u.id = s.user_id
    INNER JOIN devices d
      ON d.user_id = u.id
      AND d.revoked_at IS NULL
      AND d.expo_push_token IS NOT NULL
    WHERE s.target_type = 'publisher'
      AND s.target_id = ${publisherId}::uuid
    LIMIT ${limit}
  `);

  const list = (Array.isArray(rows) ? rows : []) as Array<{
    user_id: string;
    device_id: string;
    expo_push_token: string;
    locale: string;
    timezone: string;
    quiet_hours_start_min: number;
    quiet_hours_end_min: number;
    quiet_hours_enabled: boolean;
  }>;

  return list.map((r) => ({
    userId: r.user_id,
    deviceId: r.device_id,
    expoPushToken: r.expo_push_token,
    locale: r.locale,
    timezone: r.timezone,
    quietHoursStartMin: Number(r.quiet_hours_start_min),
    quietHoursEndMin: Number(r.quiet_hours_end_min),
    quietHoursEnabled: Boolean(r.quiet_hours_enabled),
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
    })
    .onConflictDoNothing()
    .returning({ id: schema.notifications.id });
  return inserted[0]?.id ?? null;
}

export async function releaseNotificationClaim(db: NotifyDb, notificationId: string): Promise<void> {
  await db.delete(schema.notifications).where(eq(schema.notifications.id, notificationId));
}

/** Clear stale Expo tokens after DeviceNotRegistered-style errors. */
export async function clearExpoPushToken(db: NotifyDb, deviceId: string): Promise<void> {
  await db
    .update(schema.devices)
    .set({ expoPushToken: null })
    .where(eq(schema.devices.id, deviceId));
}

export async function loadRecentNotificationCounts(
  db: NotifyDb,
  userIds: string[],
  now: Date,
): Promise<Map<string, { sentAt: Date }[]>> {
  const map = new Map<string, { sentAt: Date }[]>();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({
      userId: schema.notifications.userId,
      sentAt: schema.notifications.sentAt,
    })
    .from(schema.notifications)
    .where(
      and(
        inArray(schema.notifications.userId, userIds),
        sql`${schema.notifications.sentAt} > ${new Date(now.getTime() - 48 * 60 * 60 * 1000)}`,
      ),
    );
  for (const row of rows) {
    const list = map.get(row.userId) ?? [];
    list.push({ sentAt: row.sentAt });
    map.set(row.userId, list);
  }
  return map;
}
