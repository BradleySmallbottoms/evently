import type {
  ApprovePushMessageRequest,
  CreateAdminEventPushMessageRequest,
  CreateBroadcastPushMessageRequest,
  PushMessage,
  PushMessageAudience,
  SentEventNotification,
  UpdatePushMessageRequest,
} from '@local-events/contracts';
import {
  BROADCAST_MATCH_LIMIT,
  canAdminNotifyEvent,
  defaultPushMessageCopy,
  isOpenPushMessageStatus,
} from '@local-events/domain';
import type { Db } from '@local-events/db';
import { findOpenPushMessage, schema } from '@local-events/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

const MATCH_LIMIT = 500;

export type AdminPushMessageServices = {
  list(status?: string): Promise<PushMessage[]>;
  listSentForEvent(eventId: string): Promise<SentEventNotification[]>;
  get(id: string): Promise<PushMessage | null>;
  update(id: string, body: UpdatePushMessageRequest): Promise<PushMessage | null>;
  approve(
    id: string,
    body: ApprovePushMessageRequest,
    adminId: string,
  ): Promise<PushMessage | null>;
  reject(id: string): Promise<PushMessage | null>;
  audience(id: string): Promise<PushMessageAudience | null>;
  createBroadcast(
    body: CreateBroadcastPushMessageRequest,
    adminId: string,
  ): Promise<PushMessage>;
  createEventPush(
    body: CreateAdminEventPushMessageRequest,
    adminId: string,
  ): Promise<PushMessage>;
};

export type AdminPushEventRef = {
  id: string;
  title: string;
  status: string;
  publisherId: string;
  publisherName: string;
};

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function mapRow(row: {
  id: string;
  eventId: string | null;
  eventTitle: string | null;
  publisherId: string | null;
  publisherName: string | null;
  eventStatus: string | null;
  kind: PushMessage['kind'];
  audience: PushMessage['audience'];
  audienceTagId: string | null;
  audienceTagName: string | null;
  status: PushMessage['status'];
  titleSv: string;
  bodySv: string;
  titleEn: string;
  bodyEn: string;
  sendAt: Date | null;
  copyEdited: boolean;
  approvedAt: Date | null;
  approvedByAdminId: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): PushMessage {
  return {
    id: row.id,
    eventId: row.eventId,
    eventTitle: row.eventTitle,
    publisherId: row.publisherId,
    publisherName: row.publisherName,
    eventStatus: row.eventStatus,
    kind: row.kind,
    audience: row.audience,
    audienceTagId: row.audienceTagId,
    audienceTagName: row.audienceTagName,
    status: row.status,
    titleSv: row.titleSv,
    bodySv: row.bodySv,
    titleEn: row.titleEn,
    bodyEn: row.bodyEn,
    sendAt: toIso(row.sendAt),
    copyEdited: row.copyEdited,
    approvedAt: toIso(row.approvedAt),
    approvedByAdminId: row.approvedByAdminId,
    sentAt: toIso(row.sentAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const selectFields = {
  id: schema.pushMessages.id,
  eventId: schema.pushMessages.eventId,
  eventTitle: schema.events.title,
  publisherId: schema.events.publisherId,
  publisherName: schema.publishers.name,
  eventStatus: schema.events.status,
  kind: schema.pushMessages.kind,
  audience: schema.pushMessages.audience,
  audienceTagId: schema.pushMessages.audienceTagId,
  audienceTagName: schema.tags.name,
  status: schema.pushMessages.status,
  titleSv: schema.pushMessages.titleSv,
  bodySv: schema.pushMessages.bodySv,
  titleEn: schema.pushMessages.titleEn,
  bodyEn: schema.pushMessages.bodyEn,
  sendAt: schema.pushMessages.sendAt,
  copyEdited: schema.pushMessages.copyEdited,
  approvedAt: schema.pushMessages.approvedAt,
  approvedByAdminId: schema.pushMessages.approvedByAdminId,
  sentAt: schema.pushMessages.sentAt,
  createdAt: schema.pushMessages.createdAt,
  updatedAt: schema.pushMessages.updatedAt,
};

async function countNearby(db: Db, eventId: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM (
      SELECT DISTINCT u.id
      FROM events e
      INNER JOIN event_tags et ON et.event_id = e.id
      INNER JOIN user_interests ui ON ui.tag_id = et.tag_id
      INNER JOIN users u ON u.id = ui.user_id
      INNER JOIN user_areas ua
        ON ua.user_id = u.id
        AND ua.active = true
        AND ua.notify = true
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
      LIMIT ${MATCH_LIMIT}
    ) t
  `);
  const list = (Array.isArray(rows) ? rows : []) as Array<{ count: number }>;
  return Number(list[0]?.count ?? 0);
}

async function countPublisherFollowers(db: Db, publisherId: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS count FROM (
      SELECT DISTINCT u.id
      FROM subscriptions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.target_type = 'publisher'
        AND s.target_id = ${publisherId}::uuid
      LIMIT ${MATCH_LIMIT}
    ) t
  `);
  const list = (Array.isArray(rows) ? rows : []) as Array<{ count: number }>;
  return Number(list[0]?.count ?? 0);
}

async function countUniqueAndTokens(
  db: Db,
  eventId: string,
  publisherId: string,
): Promise<{ unique: number; withToken: number; capped: boolean }> {
  const rows = await db.execute(sql`
    WITH nearby AS (
      SELECT DISTINCT u.id AS user_id
      FROM events e
      INNER JOIN event_tags et ON et.event_id = e.id
      INNER JOIN user_interests ui ON ui.tag_id = et.tag_id
      INNER JOIN users u ON u.id = ui.user_id
      INNER JOIN user_areas ua
        ON ua.user_id = u.id AND ua.active = true AND ua.notify = true
      WHERE e.id = ${eventId}::uuid
        AND e.status = 'published'
        AND e.location IS NOT NULL
        AND (
          (ua.area IS NOT NULL AND ST_Covers(ua.area, e.location))
          OR (
            ua.center IS NOT NULL AND ua.radius_m IS NOT NULL
            AND ST_DWithin(ua.center, e.location, ua.radius_m)
          )
        )
      LIMIT ${MATCH_LIMIT}
    ),
    followers AS (
      SELECT DISTINCT s.user_id
      FROM subscriptions s
      WHERE s.target_type = 'publisher' AND s.target_id = ${publisherId}::uuid
      LIMIT ${MATCH_LIMIT}
    ),
    audience AS (
      SELECT user_id FROM nearby
      UNION
      SELECT user_id FROM followers
    )
    SELECT
      (SELECT COUNT(*)::int FROM audience) AS unique_count,
      (
        SELECT COUNT(DISTINCT a.user_id)::int
        FROM audience a
        INNER JOIN devices d ON d.user_id = a.user_id
          AND d.revoked_at IS NULL
          AND d.expo_push_token IS NOT NULL
      ) AS with_token,
      (
        SELECT CASE
          WHEN (SELECT COUNT(*) FROM nearby) >= ${MATCH_LIMIT}
            OR (SELECT COUNT(*) FROM followers) >= ${MATCH_LIMIT}
          THEN true ELSE false
        END
      ) AS capped
  `);
  const list = (Array.isArray(rows) ? rows : []) as Array<{
    unique_count: number;
    with_token: number;
    capped: boolean;
  }>;
  const row = list[0];
  return {
    unique: Number(row?.unique_count ?? 0),
    withToken: Number(row?.with_token ?? 0),
    capped: Boolean(row?.capped),
  };
}

async function countAdminEventAudience(
  db: Db,
  eventId: string,
  requireInterest: boolean,
): Promise<{ nearby: number; withToken: number; capped: boolean }> {
  const interestJoins = requireInterest
    ? sql`INNER JOIN event_tags et ON et.event_id = e.id
          INNER JOIN user_interests ui ON ui.tag_id = et.tag_id AND ui.user_id = u.id`
    : sql``;
  const rows = await db.execute(sql`
    WITH matched AS (
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
      ${interestJoins}
      WHERE e.id = ${eventId}::uuid
        AND e.status = 'published'
        AND e.location IS NOT NULL
    )
    SELECT
      (SELECT COUNT(*)::int FROM (SELECT 1 FROM matched LIMIT ${MATCH_LIMIT}) t) AS nearby,
      (
        SELECT COUNT(DISTINCT m.user_id)::int
        FROM (SELECT user_id FROM matched LIMIT ${MATCH_LIMIT}) m
        INNER JOIN devices d ON d.user_id = m.user_id
          AND d.revoked_at IS NULL
          AND d.expo_push_token IS NOT NULL
      ) AS with_token,
      ((SELECT COUNT(*) FROM matched) >= ${MATCH_LIMIT}) AS capped
  `);
  const list = (Array.isArray(rows) ? rows : []) as Array<{
    nearby: number;
    with_token: number;
    capped: boolean;
  }>;
  const row = list[0];
  return {
    nearby: Number(row?.nearby ?? 0),
    withToken: Number(row?.with_token ?? 0),
    capped: Boolean(row?.capped),
  };
}

async function countBroadcastAudience(
  db: Db,
  audience: 'everyone' | 'tag_interest',
  tagId: string | null,
): Promise<{ unique: number; withToken: number; capped: boolean }> {
  if (audience === 'everyone') {
    const rows = await db.execute(sql`
      WITH audience AS (
        SELECT id AS user_id FROM users WHERE banned_at IS NULL LIMIT ${BROADCAST_MATCH_LIMIT}
      )
      SELECT
        (SELECT COUNT(*)::int FROM audience) AS unique_count,
        (
          SELECT COUNT(DISTINCT a.user_id)::int
          FROM audience a
          INNER JOIN devices d ON d.user_id = a.user_id
            AND d.revoked_at IS NULL AND d.expo_push_token IS NOT NULL
        ) AS with_token,
        (
          SELECT CASE WHEN COUNT(*) >= ${BROADCAST_MATCH_LIMIT} THEN true ELSE false END
          FROM users WHERE banned_at IS NULL
        ) AS capped
    `);
    const list = (Array.isArray(rows) ? rows : []) as Array<{
      unique_count: number;
      with_token: number;
      capped: boolean;
    }>;
    const row = list[0];
    return {
      unique: Number(row?.unique_count ?? 0),
      withToken: Number(row?.with_token ?? 0),
      capped: Boolean(row?.capped),
    };
  }
  if (!tagId) return { unique: 0, withToken: 0, capped: false };
  const rows = await db.execute(sql`
    WITH audience AS (
      SELECT DISTINCT ui.user_id
      FROM user_interests ui
      INNER JOIN users u ON u.id = ui.user_id AND u.banned_at IS NULL
      WHERE ui.tag_id = ${tagId}::uuid
      LIMIT ${BROADCAST_MATCH_LIMIT}
    )
    SELECT
      (SELECT COUNT(*)::int FROM audience) AS unique_count,
      (
        SELECT COUNT(DISTINCT a.user_id)::int
        FROM audience a
        INNER JOIN devices d ON d.user_id = a.user_id
          AND d.revoked_at IS NULL AND d.expo_push_token IS NOT NULL
      ) AS with_token,
      (
        SELECT CASE
          WHEN (
            SELECT COUNT(DISTINCT ui.user_id)
            FROM user_interests ui
            INNER JOIN users u ON u.id = ui.user_id AND u.banned_at IS NULL
            WHERE ui.tag_id = ${tagId}::uuid
          ) >= ${BROADCAST_MATCH_LIMIT}
          THEN true ELSE false
        END
      ) AS capped
  `);
  const list = (Array.isArray(rows) ? rows : []) as Array<{
    unique_count: number;
    with_token: number;
    capped: boolean;
  }>;
  const row = list[0];
  return {
    unique: Number(row?.unique_count ?? 0),
    withToken: Number(row?.with_token ?? 0),
    capped: Boolean(row?.capped),
  };
}

export function createDbAdminPushMessageServices(db: Db): AdminPushMessageServices {
  async function load(id: string): Promise<PushMessage | null> {
    const [row] = await db
      .select(selectFields)
      .from(schema.pushMessages)
      .leftJoin(schema.events, eq(schema.events.id, schema.pushMessages.eventId))
      .leftJoin(schema.publishers, eq(schema.publishers.id, schema.events.publisherId))
      .leftJoin(schema.tags, eq(schema.tags.id, schema.pushMessages.audienceTagId))
      .where(eq(schema.pushMessages.id, id))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  return {
    async list(status) {
      const filters = status
        ? [eq(schema.pushMessages.status, status as PushMessage['status'])]
        : [inArray(schema.pushMessages.status, ['pending', 'approved', 'rejected', 'sending'])];
      const rows = await db
        .select(selectFields)
        .from(schema.pushMessages)
        .leftJoin(schema.events, eq(schema.events.id, schema.pushMessages.eventId))
        .leftJoin(schema.publishers, eq(schema.publishers.id, schema.events.publisherId))
        .leftJoin(schema.tags, eq(schema.tags.id, schema.pushMessages.audienceTagId))
        .where(and(...filters))
        .orderBy(asc(schema.pushMessages.sendAt), desc(schema.pushMessages.createdAt))
        .limit(100);
      return rows.map(mapRow);
    },

    async listSentForEvent(eventId) {
      const rows = await db
        .select({
          id: schema.pushMessages.id,
          audience: schema.pushMessages.audience,
          audienceTagName: schema.tags.name,
          status: schema.pushMessages.status,
          titleSv: schema.pushMessages.titleSv,
          bodySv: schema.pushMessages.bodySv,
          titleEn: schema.pushMessages.titleEn,
          bodyEn: schema.pushMessages.bodyEn,
          sendAt: schema.pushMessages.sendAt,
          sentAt: schema.pushMessages.sentAt,
          createdAt: schema.pushMessages.createdAt,
        })
        .from(schema.pushMessages)
        .leftJoin(schema.tags, eq(schema.tags.id, schema.pushMessages.audienceTagId))
        .where(
          and(
            eq(schema.pushMessages.eventId, eventId),
            inArray(schema.pushMessages.status, ['sent', 'sending']),
          ),
        )
        .orderBy(desc(schema.pushMessages.sentAt), desc(schema.pushMessages.createdAt));
      const counts = await recipientCounts(
        db,
        rows.map((row) => row.id),
      );
      return rows.flatMap((row) => {
        if (row.status !== 'sent' && row.status !== 'sending') return [];
        return [
          {
            id: row.id,
            status: row.status,
            audience: row.audience,
            audienceTagName: row.audienceTagName,
            titleSv: row.titleSv,
            bodySv: row.bodySv,
            titleEn: row.titleEn,
            bodyEn: row.bodyEn,
            sendAt: toIso(row.sendAt),
            sentAt: toIso(row.sentAt),
            createdAt: row.createdAt.toISOString(),
            recipientCount: counts.get(row.id) ?? 0,
          },
        ];
      });
    },

    get: load,

    async update(id, body) {
      const existing = await load(id);
      if (!existing) return null;
      if (
        existing.status === 'sent' ||
        existing.status === 'sending' ||
        existing.status === 'cancelled'
      ) {
        return null;
      }
      const now = new Date();
      const copyTouched =
        body.titleSv !== undefined ||
        body.bodySv !== undefined ||
        body.titleEn !== undefined ||
        body.bodyEn !== undefined;
      await db
        .update(schema.pushMessages)
        .set({
          ...(body.titleSv !== undefined ? { titleSv: body.titleSv } : {}),
          ...(body.bodySv !== undefined ? { bodySv: body.bodySv } : {}),
          ...(body.titleEn !== undefined ? { titleEn: body.titleEn } : {}),
          ...(body.bodyEn !== undefined ? { bodyEn: body.bodyEn } : {}),
          ...(body.sendAt !== undefined
            ? { sendAt: body.sendAt ? new Date(body.sendAt) : null }
            : {}),
          ...(copyTouched ? { copyEdited: true } : {}),
          ...(existing.kind === 'event' &&
          existing.status === 'approved' &&
          copyTouched
            ? { status: 'pending' as const, approvedAt: null, approvedByAdminId: null }
            : {}),
          updatedAt: now,
        })
        .where(eq(schema.pushMessages.id, id));
      return load(id);
    },

    async approve(id, body, adminId) {
      const existing = await load(id);
      if (!existing) return null;
      if (
        existing.status !== 'pending' &&
        existing.status !== 'rejected' &&
        existing.status !== 'approved'
      ) {
        return null;
      }
      const now = new Date();
      await db
        .update(schema.pushMessages)
        .set({
          status: 'approved',
          approvedAt: now,
          approvedByAdminId: adminId,
          ...(body.sendAt !== undefined
            ? { sendAt: body.sendAt ? new Date(body.sendAt) : null }
            : {}),
          updatedAt: now,
        })
        .where(eq(schema.pushMessages.id, id));
      return load(id);
    },

    async reject(id) {
      const existing = await load(id);
      if (!existing) return null;
      if (existing.status !== 'pending' && existing.status !== 'approved') return null;
      const now = new Date();
      await db
        .update(schema.pushMessages)
        .set({
          status: 'rejected',
          approvedAt: null,
          approvedByAdminId: null,
          updatedAt: now,
        })
        .where(eq(schema.pushMessages.id, id));
      return load(id);
    },

    async audience(id) {
      const existing = await load(id);
      if (!existing) return null;
      if (existing.kind === 'broadcast') {
        const stats = await countBroadcastAudience(
          db,
          existing.audience === 'tag_interest' ? 'tag_interest' : 'everyone',
          existing.audienceTagId,
        );
        return {
          nearby: 0,
          publisherFollowers: 0,
          uniqueRecipients: stats.unique,
          withPushToken: stats.withToken,
          capped: stats.capped,
          eventPublished: true,
        };
      }
      if (!existing.eventId || !existing.publisherId) {
        return {
          nearby: 0,
          publisherFollowers: 0,
          uniqueRecipients: 0,
          withPushToken: 0,
          capped: false,
          eventPublished: false,
        };
      }
      const eventPublished = existing.eventStatus === 'published';
      if (existing.audience === 'area' || existing.audience === 'area_and_tag') {
        const stats = eventPublished
          ? await countAdminEventAudience(db, existing.eventId, existing.audience === 'area_and_tag')
          : { nearby: 0, withToken: 0, capped: false };
        return {
          nearby: stats.nearby,
          publisherFollowers: 0,
          uniqueRecipients: stats.nearby,
          withPushToken: stats.withToken,
          capped: stats.capped,
          eventPublished,
        };
      }
      const nearby = eventPublished ? await countNearby(db, existing.eventId) : 0;
      const publisherFollowers = await countPublisherFollowers(db, existing.publisherId);
      const { unique, withToken, capped } = eventPublished
        ? await countUniqueAndTokens(db, existing.eventId, existing.publisherId)
        : {
            unique: publisherFollowers,
            withToken: 0,
            capped: publisherFollowers >= MATCH_LIMIT,
          };
      return {
        nearby,
        publisherFollowers,
        uniqueRecipients: unique,
        withPushToken: withToken,
        capped,
        eventPublished,
      };
    },

    async createBroadcast(body, adminId) {
      if (body.audience === 'tag_interest') {
        const [tag] = await db
          .select({ id: schema.tags.id })
          .from(schema.tags)
          .where(eq(schema.tags.id, body.audienceTagId!))
          .limit(1);
        if (!tag) throw new Error('invalid_tag');
      }
      const now = new Date();
      const [created] = await db
        .insert(schema.pushMessages)
        .values({
          eventId: null,
          kind: 'broadcast',
          audience: body.audience,
          audienceTagId: body.audience === 'tag_interest' ? body.audienceTagId! : null,
          status: 'approved',
          titleSv: body.titleSv,
          bodySv: body.bodySv,
          titleEn: body.titleEn,
          bodyEn: body.bodyEn,
          copyEdited: true,
          sendAt: body.sendAt ? new Date(body.sendAt) : null,
          approvedAt: now,
          approvedByAdminId: adminId,
          updatedAt: now,
        })
        .returning({ id: schema.pushMessages.id });
      if (!created) throw new Error('push_broadcast_failed');
      const loaded = await load(created.id);
      if (!loaded) throw new Error('push_broadcast_failed');
      return loaded;
    },

    async createEventPush(body, adminId) {
      const [event] = await db
        .select({
          id: schema.events.id,
          title: schema.events.title,
          status: schema.events.status,
          publisherId: schema.events.publisherId,
          publisherName: schema.publishers.name,
        })
        .from(schema.events)
        .innerJoin(schema.publishers, eq(schema.publishers.id, schema.events.publisherId))
        .where(eq(schema.events.id, body.eventId))
        .limit(1);
      if (!event) throw new Error('event_not_found');
      if (!canAdminNotifyEvent(event.status)) throw new Error('event_not_published');
      const open = await findOpenPushMessage(db, event.id);
      if (open) throw new Error('push_draft_exists');
      const defaults = defaultPushMessageCopy(event.title);
      const hasCopy = Boolean(body.titleSv || body.bodySv || body.titleEn || body.bodyEn);
      const now = new Date();
      const [created] = await db
        .insert(schema.pushMessages)
        .values({
          eventId: event.id,
          kind: 'event',
          audience: body.audience,
          status: 'approved',
          titleSv: body.titleSv ?? defaults.titleSv,
          bodySv: body.bodySv ?? defaults.bodySv,
          titleEn: body.titleEn ?? defaults.titleEn,
          bodyEn: body.bodyEn ?? defaults.bodyEn,
          copyEdited: hasCopy,
          sendAt: body.sendAt ? new Date(body.sendAt) : null,
          approvedAt: now,
          approvedByAdminId: adminId,
          updatedAt: now,
        })
        .returning({ id: schema.pushMessages.id });
      if (!created) throw new Error('push_event_failed');
      const loaded = await load(created.id);
      if (!loaded) throw new Error('push_event_failed');
      return loaded;
    },
  };
}

function sentNotificationFromPush(
  row: PushMessage,
  recipientCount: number,
): SentEventNotification | null {
  if (row.status !== 'sent' && row.status !== 'sending') return null;
  return {
    id: row.id,
    status: row.status,
    audience: row.audience,
    audienceTagName: row.audienceTagName ?? null,
    titleSv: row.titleSv,
    bodySv: row.bodySv,
    titleEn: row.titleEn,
    bodyEn: row.bodyEn,
    sendAt: row.sendAt,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
    recipientCount,
  };
}

/** Matches Postgres `ORDER BY sent_at DESC` (nulls first), then created_at DESC. */
function compareSentDesc(a: SentEventNotification, b: SentEventNotification): number {
  if (a.sentAt == null && b.sentAt != null) return -1;
  if (b.sentAt == null && a.sentAt != null) return 1;
  if (a.sentAt != null && b.sentAt != null && a.sentAt !== b.sentAt) {
    return b.sentAt.localeCompare(a.sentAt);
  }
  return b.createdAt.localeCompare(a.createdAt);
}

async function recipientCounts(db: Db, ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const rows = await db
    .select({
      pushMessageId: schema.notifications.pushMessageId,
      count: sql<number>`count(distinct ${schema.notifications.userId})::int`,
    })
    .from(schema.notifications)
    .where(inArray(schema.notifications.pushMessageId, ids))
    .groupBy(schema.notifications.pushMessageId);
  for (const row of rows) {
    if (row.pushMessageId) counts.set(row.pushMessageId, Number(row.count));
  }
  return counts;
}

export function createMemoryAdminPushMessageServices(input?: {
  events?: Map<string, AdminPushEventRef>;
  items?: Map<string, PushMessage>;
  recipientCounts?: Map<string, number>;
}): AdminPushMessageServices {
  const events = input?.events ?? new Map<string, AdminPushEventRef>();
  const items = input?.items ?? new Map<string, PushMessage>();
  const recipients = input?.recipientCounts ?? new Map<string, number>();
  return {
    async list(status) {
      return [...items.values()].filter((i) => !status || i.status === status);
    },
    async listSentForEvent(eventId) {
      return [...items.values()]
        .filter((row) => row.eventId === eventId)
        .flatMap((row) => {
          const sent = sentNotificationFromPush(row, recipients.get(row.id) ?? 0);
          return sent ? [sent] : [];
        })
        .sort(compareSentDesc);
    },
    async get(id) {
      return items.get(id) ?? null;
    },
    async update(id, body) {
      const row = items.get(id);
      if (!row) return null;
      const next = {
        ...row,
        ...body,
        sendAt: body.sendAt === undefined ? row.sendAt : body.sendAt,
        copyEdited: true,
        updatedAt: new Date().toISOString(),
      };
      items.set(id, next);
      return next;
    },
    async approve(id, body, adminId) {
      const row = items.get(id);
      if (!row) return null;
      const next: PushMessage = {
        ...row,
        status: 'approved',
        approvedAt: new Date().toISOString(),
        approvedByAdminId: adminId,
        sendAt: body.sendAt === undefined ? row.sendAt : body.sendAt,
        updatedAt: new Date().toISOString(),
      };
      items.set(id, next);
      return next;
    },
    async reject(id) {
      const row = items.get(id);
      if (!row) return null;
      const next: PushMessage = {
        ...row,
        status: 'rejected',
        approvedAt: null,
        approvedByAdminId: null,
        updatedAt: new Date().toISOString(),
      };
      items.set(id, next);
      return next;
    },
    async audience() {
      return {
        nearby: 0,
        publisherFollowers: 0,
        uniqueRecipients: 0,
        withPushToken: 0,
        capped: false,
        eventPublished: false,
      };
    },
    async createBroadcast(body, adminId) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const row: PushMessage = {
        id,
        eventId: null,
        eventTitle: null,
        publisherId: null,
        publisherName: null,
        eventStatus: null,
        kind: 'broadcast',
        audience: body.audience,
        audienceTagId: body.audienceTagId ?? null,
        status: 'approved',
        titleSv: body.titleSv,
        bodySv: body.bodySv,
        titleEn: body.titleEn,
        bodyEn: body.bodyEn,
        sendAt: body.sendAt ?? null,
        copyEdited: true,
        approvedAt: now,
        approvedByAdminId: adminId,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      };
      items.set(id, row);
      return row;
    },
    async createEventPush(body, adminId) {
      const event = events.get(body.eventId);
      if (!event) throw new Error('event_not_found');
      if (!canAdminNotifyEvent(event.status)) throw new Error('event_not_published');
      const open = [...items.values()].find(
        (row) => row.eventId === event.id && isOpenPushMessageStatus(row.status),
      );
      if (open) throw new Error('push_draft_exists');
      const defaults = defaultPushMessageCopy(event.title);
      const hasCopy = Boolean(body.titleSv || body.bodySv || body.titleEn || body.bodyEn);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const row: PushMessage = {
        id,
        eventId: event.id,
        eventTitle: event.title,
        publisherId: event.publisherId,
        publisherName: event.publisherName,
        eventStatus: event.status,
        kind: 'event',
        audience: body.audience,
        audienceTagId: null,
        status: 'approved',
        titleSv: body.titleSv ?? defaults.titleSv,
        bodySv: body.bodySv ?? defaults.bodySv,
        titleEn: body.titleEn ?? defaults.titleEn,
        bodyEn: body.bodyEn ?? defaults.bodyEn,
        sendAt: body.sendAt ?? null,
        copyEdited: hasCopy,
        approvedAt: now,
        approvedByAdminId: adminId,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      };
      items.set(id, row);
      return row;
    },
  };
}
