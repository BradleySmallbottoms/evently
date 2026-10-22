import { markTipPublished, type Db } from '@local-events/db';
import type { HandleDuePushDeps } from './handle-due-push';
import { handleTipScanned } from './handle-tip';

/** Sets a reviewed tip to published and sends the notice that the event was added. */
export async function publishTipForEvent(
  db: Db,
  eventId: string,
  now: Date,
  notify?: HandleDuePushDeps,
): Promise<void> {
  const tip = await markTipPublished(db, eventId, now);
  if (!tip || !notify) return;
  await handleTipScanned({ tipId: tip.id, eventId, status: 'published' }, notify, {
    followUp: true,
  });
}
