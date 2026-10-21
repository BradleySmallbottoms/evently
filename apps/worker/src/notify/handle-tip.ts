import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { tipScanNotification, type TipExtraction } from '@local-events/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { isPushDryRun, type ExpoPushClient, type ExpoPushMessage } from './expo-push';
import { loadPushDevicesForUsers } from './match';

export function tipPushMessages(input: {
  tokens: string[];
  locale: 'sv' | 'en';
  status: 'published' | 'in_review' | 'failed' | 'needs_input';
  title: string;
  place: string | null;
  tipId: string;
  eventId: string | null;
}): ExpoPushMessage[] {
  const copy = tipScanNotification(input);
  return input.tokens.map((to) => ({
    to,
    title: copy.title,
    body: copy.body,
    sound: 'default' as const,
    priority: 'high' as const,
    data: {
      kind: 'tip_scan',
      tipId: input.tipId,
      eventId: input.eventId ?? '',
      status: input.status,
      title: copy.title,
      body: copy.body,
    },
  }));
}

async function alreadyNotified(db: Db, userId: string, eventId: string | null): Promise<boolean> {
  if (!eventId) return false;
  const [row] = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.eventId, eventId),
        eq(schema.notifications.reason, 'tip'),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function handleTipScanned(
  input: { tipId: string; eventId: string; status: 'published' | 'in_review' | 'failed' },
  deps: { db: Db; expo: ExpoPushClient; now?: () => Date },
): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const [tip] = await deps.db
    .select()
    .from(schema.eventTips)
    .where(eq(schema.eventTips.id, input.tipId))
    .limit(1);
  if (!tip) return;
  if (await alreadyNotified(deps.db, tip.userId, input.eventId)) return;
  const [event] = await deps.db
    .select({
      title: schema.events.title,
      venueName: schema.events.venueName,
    })
    .from(schema.events)
    .where(eq(schema.events.id, input.eventId))
    .limit(1);
  await sendTipPush(deps, {
    userId: tip.userId,
    locale: tip.locale,
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
  const [existing] = await deps.db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, tip.userId),
        isNull(schema.notifications.eventId),
        eq(schema.notifications.reason, 'tip'),
      ),
    )
    .limit(1);
  if (existing) return;
  const extracted = (tip.extracted ?? {}) as TipExtraction;
  await sendTipPush(deps, {
    userId: tip.userId,
    locale: tip.locale,
    status: 'needs_input',
    title: extracted.title?.trim() || (tip.locale === 'en' ? 'Your tip' : 'Ditt tips'),
    place: extracted.place ?? null,
    tipId: tip.id,
    eventId: null,
    now,
  });
}

async function sendTipPush(
  deps: { db: Db; expo: ExpoPushClient },
  input: {
    userId: string;
    locale: 'sv' | 'en';
    status: 'published' | 'in_review' | 'failed' | 'needs_input';
    title: string;
    place: string | null;
    tipId: string;
    eventId: string | null;
    now: Date;
  },
) {
  await deps.db.insert(schema.notifications).values({
    userId: input.userId,
    eventId: input.eventId,
    reason: 'tip',
    sentAt: input.now,
    pushState: 'sent',
    pushedAt: input.now,
  });
  const devices = await loadPushDevicesForUsers(deps.db, [input.userId]);
  const messages = tipPushMessages({
    ...input,
    tokens: devices.map((device) => device.expoPushToken),
  });
  if (messages.length === 0 || isPushDryRun()) return;
  await deps.expo.send(messages);
}
