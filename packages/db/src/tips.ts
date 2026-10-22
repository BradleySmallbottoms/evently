import { and, eq } from 'drizzle-orm';
import type { Db } from './index';
import * as schema from './schema';

/**
 * The scan stores `in_review`. Publishing the event is what marks the tip published.
 * A second call changes nothing, so a repeated publish does not notify again.
 */
export async function markTipPublished(
  db: Db,
  eventId: string,
  now: Date,
): Promise<{ id: string } | null> {
  const [row] = await db
    .update(schema.eventTips)
    .set({ scanStatus: 'published', updatedAt: now })
    .where(
      and(
        eq(schema.eventTips.eventId, eventId),
        eq(schema.eventTips.status, 'scanned'),
        eq(schema.eventTips.scanStatus, 'in_review'),
      ),
    )
    .returning({ id: schema.eventTips.id });
  return row ?? null;
}
