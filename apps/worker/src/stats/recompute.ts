import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import type { StatMutation } from '@local-events/domain';
import { and, count, eq, inArray, sum } from 'drizzle-orm';
import type { StatsWriter } from './apply';

/**
 * Nightly lifetime-key reconcile from source tables (`value` ops via API writer).
 * Historical day/week/month buckets are not rebuilt.
 */

async function setValue(
  writer: StatsWriter,
  sourceType: 'user' | 'event' | 'publisher',
  sourceId: string,
  key: string,
  value: number,
): Promise<void> {
  const op: StatMutation = { key, value };
  await writer.put(sourceType, sourceId, [op]);
}

export async function reconcileAllStats(
  db: Db,
  writer: StatsWriter,
): Promise<{ users: number; events: number; publishers: number }> {
  const userIds = new Set<string>();
  for (const row of await db
    .selectDistinct({ userId: schema.checkIns.userId })
    .from(schema.checkIns)) {
    userIds.add(row.userId);
  }
  for (const row of await db
    .selectDistinct({ userId: schema.ratings.userId })
    .from(schema.ratings)) {
    userIds.add(row.userId);
  }
  for (const userId of userIds) {
    const [attended] = await db
      .select({ n: count() })
      .from(schema.checkIns)
      .where(eq(schema.checkIns.userId, userId));
    const [rated] = await db
      .select({ n: count() })
      .from(schema.ratings)
      .where(eq(schema.ratings.userId, userId));
    await setValue(writer, 'user', userId, 'numEventsAttended', Number(attended?.n ?? 0));
    await setValue(writer, 'user', userId, 'numEventsRated', Number(rated?.n ?? 0));
  }

  const eventIds = new Set<string>();
  for (const row of await db
    .selectDistinct({ eventId: schema.checkIns.eventId })
    .from(schema.checkIns)) {
    eventIds.add(row.eventId);
  }
  for (const row of await db
    .selectDistinct({ eventId: schema.ratings.eventId })
    .from(schema.ratings)) {
    eventIds.add(row.eventId);
  }
  for (const row of await db
    .selectDistinct({ eventId: schema.savedEvents.eventId })
    .from(schema.savedEvents)) {
    eventIds.add(row.eventId);
  }
  for (const row of await db
    .selectDistinct({ eventId: schema.comingEvents.eventId })
    .from(schema.comingEvents)) {
    eventIds.add(row.eventId);
  }
  for (const row of await db
    .selectDistinct({ eventId: schema.stats.sourceId })
    .from(schema.stats)
    .where(
      and(
        eq(schema.stats.sourceType, 'event'),
        inArray(schema.stats.key, ['numSaved', 'numComing']),
      ),
    )) {
    eventIds.add(row.eventId);
  }

  for (const eventId of eventIds) {
    const [checkIns] = await db
      .select({ n: count() })
      .from(schema.checkIns)
      .where(eq(schema.checkIns.eventId, eventId));
    const [ratingRow] = await db
      .select({
        n: count(),
        total: sum(schema.ratings.score),
      })
      .from(schema.ratings)
      .where(eq(schema.ratings.eventId, eventId));
    const [saved] = await db
      .select({ n: count() })
      .from(schema.savedEvents)
      .where(eq(schema.savedEvents.eventId, eventId));
    const [coming] = await db
      .select({ n: count() })
      .from(schema.comingEvents)
      .where(eq(schema.comingEvents.eventId, eventId));
    await setValue(writer, 'event', eventId, 'numCheckins', Number(checkIns?.n ?? 0));
    await setValue(writer, 'event', eventId, 'numRatings', Number(ratingRow?.n ?? 0));
    await setValue(writer, 'event', eventId, 'totalRatingValue', Number(ratingRow?.total ?? 0));
    await setValue(writer, 'event', eventId, 'numSaved', Number(saved?.n ?? 0));
    await setValue(writer, 'event', eventId, 'numComing', Number(coming?.n ?? 0));
  }

  const publishedEvents = await db
    .select({ id: schema.events.id, publisherId: schema.events.publisherId })
    .from(schema.events)
    .where(eq(schema.events.status, 'published'));
  const publisherIds = new Set<string>();
  for (const event of publishedEvents) {
    if (event.publisherId) publisherIds.add(event.publisherId);
  }
  for (const eventId of eventIds) {
    const [ev] = await db
      .select({ publisherId: schema.events.publisherId })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (ev?.publisherId) publisherIds.add(ev.publisherId);
  }

  for (const publisherId of publisherIds) {
    const [published] = await db
      .select({ n: count() })
      .from(schema.events)
      .where(
        and(eq(schema.events.publisherId, publisherId), eq(schema.events.status, 'published')),
      );
    const eventRows = await db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.publisherId, publisherId));
    const ids = eventRows.map((e) => e.id);
    let checkInsCount = 0;
    let ratingsCount = 0;
    let totalRatingValue = 0;
    if (ids.length > 0) {
      const [checkIns] = await db
        .select({ n: count() })
        .from(schema.checkIns)
        .where(inArray(schema.checkIns.eventId, ids));
      const [ratingRow] = await db
        .select({ n: count(), total: sum(schema.ratings.score) })
        .from(schema.ratings)
        .where(inArray(schema.ratings.eventId, ids));
      checkInsCount = Number(checkIns?.n ?? 0);
      ratingsCount = Number(ratingRow?.n ?? 0);
      totalRatingValue = Number(ratingRow?.total ?? 0);
    }
    await setValue(
      writer,
      'publisher',
      publisherId,
      'numPublishedEvents',
      Number(published?.n ?? 0),
    );
    await setValue(writer, 'publisher', publisherId, 'numCheckins', checkInsCount);
    await setValue(writer, 'publisher', publisherId, 'numRatings', ratingsCount);
    await setValue(writer, 'publisher', publisherId, 'totalRatingValue', totalRatingValue);
  }

  return {
    users: userIds.size,
    events: eventIds.size,
    publishers: publisherIds.size,
  };
}
