import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { tipScanNotification, type TipExtraction } from '@local-events/domain';
import { and, eq, isNull, notInArray } from 'drizzle-orm';
import type { ExpoPushClient, ExpoPushMessage } from './expo-push';

export function tipPushMessages(input: {
  tokens: string[];
  locale: 'sv' | 'en';
  status: 'published' | 'in_review' | 'failed' | 'needs_input';
  title: string;
  place: string | null;
  tipId: string;
  eventId: string | null;
  badge: number;
}): ExpoPushMessage[] {
  const copy = tipScanNotification(input);
  return visibleTipPush({
    tokens: input.tokens,
    title: copy.title,
    body: copy.body,
    status: input.status,
    tipId: input.tipId,
    eventId: input.eventId,
    badge: input.badge,
  });
}

/** Visible tip alert from copy already stored on the push_messages row. */
export function visibleTipPush(input: {
  tokens: string[];
  title: string;
  body: string;
  status: string;
  tipId: string;
  eventId: string | null;
  badge: number;
}): ExpoPushMessage[] {
  return input.tokens.map((to) => ({
    to,
    title: input.title,
    body: input.body,
    sound: 'default' as const,
    priority: 'high' as const,
    badge: input.badge,
    data: {
      kind: 'tip_scan',
      tipId: input.tipId,
      eventId: input.eventId ?? '',
      status: input.status,
      title: input.title,
      body: input.body,
      badge: String(input.badge),
    },
  }));
}

async function alreadyNotified(db: Db, userId: string, eventId: string | null): Promise<boolean> {
  if (!eventId) return false;
  return (await tipNoticeCount(db, userId, eventId)) >= 1;
}

/**
 * One notice is either a tip push_messages row or an older inbox row that was
 * inserted directly (no push_message_id). Counting both keeps a published
 * follow-up working for tips that were notified before they were scheduled.
 */
async function tipNoticeCount(db: Db, userId: string, eventId: string): Promise<number> {
  const scheduled = await db
    .select({ id: schema.pushMessages.id })
    .from(schema.pushMessages)
    .where(
      and(
        eq(schema.pushMessages.eventId, eventId),
        eq(schema.pushMessages.kind, 'tip'),
        eq(schema.pushMessages.audienceUserId, userId),
        notInArray(schema.pushMessages.status, ['cancelled', 'rejected']),
      ),
    )
    .limit(2);
  const legacy = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.eventId, eventId),
        eq(schema.notifications.reason, 'tip'),
        isNull(schema.notifications.pushMessageId),
      ),
    )
    .limit(2);
  return scheduled.length + legacy.length;
}

export async function handleTipScanned(
  input: { tipId: string; eventId: string; status: 'published' | 'in_review' | 'failed' },
  deps: { db: Db; expo: ExpoPushClient; now?: () => Date },
  options?: { followUp?: boolean },
): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const [tip] = await deps.db
    .select()
    .from(schema.eventTips)
    .where(eq(schema.eventTips.id, input.tipId))
    .limit(1);
  if (!tip) return;
  if (options?.followUp) {
    // The review notice is already there. One more row is the published notice.
    if ((await tipNoticeCount(deps.db, tip.userId, input.eventId)) !== 1) return;
  } else if (await alreadyNotified(deps.db, tip.userId, input.eventId)) return;
  const [event] = await deps.db
    .select({
      title: schema.events.title,
      venueName: schema.eventOccasions.venueName,
    })
    .from(schema.events)
    .leftJoin(schema.eventOccasions, eq(schema.eventOccasions.eventId, schema.events.id))
    .where(eq(schema.events.id, input.eventId))
    .orderBy(schema.eventOccasions.startsAt)
    .limit(1);
  await sendTipPush(deps, {
    userId: tip.userId,
    status: input.status,
    title: event?.title ?? 'Event',
    place: event?.venueName ?? null,
    tipId: tip.id,
    eventId: input.eventId,
    now,
  });
}

export async function handleTipNeedsInput(
  input: { tipId: string; userId: string },
  deps: { db: Db; expo: ExpoPushClient; now?: () => Date },
): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const [tip] = await deps.db
    .select()
    .from(schema.eventTips)
    .where(eq(schema.eventTips.id, input.tipId))
    .limit(1);
  if (!tip || tip.userId !== input.userId) return;
  const [scheduled] = await deps.db
    .select({ id: schema.pushMessages.id })
    .from(schema.pushMessages)
    .where(
      and(
        eq(schema.pushMessages.tipId, tip.id),
        eq(schema.pushMessages.kind, 'tip'),
        isNull(schema.pushMessages.eventId),
        notInArray(schema.pushMessages.status, ['cancelled', 'rejected']),
      ),
    )
    .limit(1);
  if (scheduled) return;
  const [existing] = await deps.db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, tip.userId),
        isNull(schema.notifications.eventId),
        eq(schema.notifications.reason, 'tip'),
        isNull(schema.notifications.pushMessageId),
      ),
    )
    .limit(1);
  if (existing) return;
  const extracted = (tip.extracted ?? {}) as TipExtraction;
  await sendTipPush(deps, {
    userId: tip.userId,
    status: 'needs_input',
    title: extracted.title?.trim() || (tip.locale === 'en' ? 'Your tip' : 'Ditt tips'),
    place: extracted.place ?? null,
    tipId: tip.id,
    eventId: null,
    now,
  });
}

/** Approved tip row with send_at null. The next due-push tick delivers it. */
async function sendTipPush(
  deps: { db: Db },
  input: {
    userId: string;
    status: 'published' | 'in_review' | 'failed' | 'needs_input';
    title: string;
    place: string | null;
    tipId: string;
    eventId: string | null;
    now: Date;
  },
) {
  const sv = tipScanNotification({ ...input, locale: 'sv' });
  const en = tipScanNotification({ ...input, locale: 'en' });
  await deps.db.insert(schema.pushMessages).values({
    eventId: input.eventId,
    kind: 'tip',
    audience: 'user',
    audienceUserId: input.userId,
    tipId: input.tipId,
    tipStatus: input.status,
    status: 'approved',
    approvedAt: input.now,
    titleSv: sv.title,
    bodySv: sv.body,
    titleEn: en.title,
    bodyEn: en.body,
    sendAt: null,
  });
}
