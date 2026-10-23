import type { Db } from '@local-events/db';
import { insertApprovedEventReminders, schema } from '@local-events/db';
import {
  IMPORT_NOTIFICATION_AUDIENCE,
  importNotificationMessages,
  pushStatusForEvent,
  type MarketingPushPlanId,
} from '@local-events/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';

/** Schedule a publisher plan for one imported event. Skips reminders already in the past. */
export async function scheduleImportPlanForEvent(
  db: Db,
  input: {
    eventId: string;
    eventTitle: string;
    startsAt: Date;
    eventStatus: string;
    planId: MarketingPushPlanId;
    now?: Date;
  },
): Promise<number> {
  const now = input.now ?? new Date();
  const messages = importNotificationMessages({
    planId: input.planId,
    eventTitle: input.eventTitle,
    startsAt: input.startsAt,
    now,
  });
  return insertApprovedEventReminders(db, {
    eventId: input.eventId,
    audience: IMPORT_NOTIFICATION_AUDIENCE,
    status: pushStatusForEvent(input.eventStatus),
    now,
    notifications: messages.map((message) => ({
      titleSv: message.copy.titleSv,
      bodySv: message.copy.bodySv,
      titleEn: message.copy.titleEn,
      bodyEn: message.copy.bodyEn,
      sendAt: message.sendAt,
    })),
  });
}

/** Schedule the plan for this publisher's upcoming published and in-review imports. */
export async function scheduleImportPlanForPublisher(
  db: Db,
  publisherId: string,
  planId: MarketingPushPlanId,
  now = new Date(),
): Promise<number> {
  const rows = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      startsAt: sql<Date | null>`(
        select min(${schema.eventOccasions.startsAt})
        from ${schema.eventOccasions}
        where ${schema.eventOccasions.eventId} = ${schema.events.id}
          and ${schema.eventOccasions.startsAt} > ${now}
      )`,
      status: schema.events.status,
    })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.publisherId, publisherId),
        eq(schema.events.origin, 'imported'),
        inArray(schema.events.status, ['published', 'in_review']),
      ),
    );
  let count = 0;
  for (const row of rows) {
    if (!row.startsAt) continue;
    count += await scheduleImportPlanForEvent(db, {
      eventId: row.id,
      eventTitle: row.title,
      startsAt: row.startsAt,
      eventStatus: row.status,
      planId,
      now,
    });
  }
  return count;
}
