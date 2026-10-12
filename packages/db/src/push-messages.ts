import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './index';
import * as schema from './schema';

const OPEN_STATUSES = ['pending', 'approved', 'sending', 'rejected'] as const;

export type PushMessageRow = typeof schema.pushMessages.$inferSelect;

export async function findOpenPushMessage(
  db: Db,
  eventId: string,
): Promise<PushMessageRow | null> {
  const [row] = await db
    .select()
    .from(schema.pushMessages)
    .where(
      and(
        eq(schema.pushMessages.eventId, eventId),
        inArray(schema.pushMessages.status, [...OPEN_STATUSES]),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findLatestSentPushMessage(
  db: Db,
  eventId: string,
): Promise<PushMessageRow | null> {
  const [row] = await db
    .select()
    .from(schema.pushMessages)
    .where(
      and(eq(schema.pushMessages.eventId, eventId), eq(schema.pushMessages.status, 'sent')),
    )
    .orderBy(desc(schema.pushMessages.sentAt))
    .limit(1);
  return row ?? null;
}

export async function insertPushMessage(
  db: Db,
  values: typeof schema.pushMessages.$inferInsert,
): Promise<PushMessageRow> {
  const [created] = await db.insert(schema.pushMessages).values(values).returning();
  if (!created) throw new Error('push_message_insert_failed');
  return created;
}

export async function updatePushMessage(
  db: Db,
  id: string,
  values: Partial<typeof schema.pushMessages.$inferInsert>,
): Promise<PushMessageRow | null> {
  const [updated] = await db
    .update(schema.pushMessages)
    .set(values)
    .where(eq(schema.pushMessages.id, id))
    .returning();
  return updated ?? null;
}

export async function cancelOpenPushMessages(
  db: Db,
  eventId: string,
  now = new Date(),
): Promise<number> {
  const result = await db
    .update(schema.pushMessages)
    .set({ status: 'cancelled', updatedAt: now })
    .where(
      and(
        eq(schema.pushMessages.eventId, eventId),
        inArray(schema.pushMessages.status, [...OPEN_STATUSES]),
      ),
    )
    .returning({ id: schema.pushMessages.id });
  return result.length;
}

/** Approve every open pending/rejected draft for a publisher (e.g. on verify). */
export async function approveOpenPushMessagesForPublisher(
  db: Db,
  publisherId: string,
  now = new Date(),
): Promise<number> {
  // Raw sql`` params skip drizzle's timestamp encoder; bind ISO strings.
  const nowIso = now.toISOString();
  const result = await db.execute(sql`
    UPDATE push_messages pm
    SET status = 'approved',
        approved_at = ${nowIso},
        approved_by_admin_id = NULL,
        updated_at = ${nowIso}
    FROM events e
    WHERE e.id = pm.event_id
      AND e.publisher_id = ${publisherId}::uuid
      AND pm.status IN ('pending', 'rejected')
      AND e.status IN ('published', 'awaiting_verification')
    RETURNING pm.id
  `);
  const rows = (Array.isArray(result) ? result : []) as unknown[];
  return rows.length;
}
