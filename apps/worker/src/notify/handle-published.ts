import type { Db } from '@local-events/db';
import type { ExpoPushClient, ExpoPushMessage } from './expo-push';
import {
  claimNotification,
  clearExpoPushToken,
  countUnreadNotifications,
  findNearbyMatchedUsers,
  findPublisherSubscriberUsers,
  loadPublishedEvent,
  loadPushDevicesForUsers,
  markNotificationsPushed,
  purgeExpiredNotifications,
  type PushDevice,
} from './match';

export type HandlePublishedDeps = {
  db: Db;
  expo: ExpoPushClient;
  now?: () => Date;
};

const MATCH_LIMIT = 500;

type NotifyReason = 'nearby' | 'publisher';

/** Nearby wins when a user matches both paths — one inbox row / silent push per event. */
function mergeUsers(
  nearby: { userId: string }[],
  publisher: { userId: string }[],
): Map<string, NotifyReason> {
  const merged = new Map<string, NotifyReason>();
  for (const u of nearby) merged.set(u.userId, 'nearby');
  for (const u of publisher) {
    if (!merged.has(u.userId)) merged.set(u.userId, 'publisher');
  }
  return merged;
}

type PendingSend = {
  notificationId: string;
  userId: string;
  devices: PushDevice[];
  messages: ExpoPushMessage[];
};

/**
 * Fan out for a published event: nearby geo match + publisher followers.
 * Always inserts an inbox row (dedupe), then always sends a silent Expo push to
 * devices with tokens. Quiet hours and daily cap are enforced on the client.
 * Idempotent via notifications unique (user, event, reason).
 */
export async function handleEventPublished(
  eventId: string,
  deps: HandlePublishedDeps,
): Promise<{ matched: number; claimed: number; sent: number; skipped: number }> {
  const now = deps.now?.() ?? new Date();
  const purged = await purgeExpiredNotifications(deps.db, now);
  if (purged > 0) {
    console.log(JSON.stringify({ purge: 'notifications', deleted: purged }));
  }

  const event = await loadPublishedEvent(deps.db, eventId);
  if (!event || event.status !== 'published') {
    return { matched: 0, claimed: 0, sent: 0, skipped: 0 };
  }

  const nearby = event.hasLocation
    ? await findNearbyMatchedUsers(deps.db, eventId, MATCH_LIMIT)
    : [];
  const publisherSubs = await findPublisherSubscriberUsers(deps.db, event.publisherId, MATCH_LIMIT);
  if (nearby.length >= MATCH_LIMIT || publisherSubs.length >= MATCH_LIMIT) {
    console.warn(
      JSON.stringify({
        warn: 'notify_match_limit',
        eventId,
        nearby: nearby.length,
        publisher: publisherSubs.length,
        limit: MATCH_LIMIT,
      }),
    );
  }

  const byUser = mergeUsers(nearby, publisherSubs);
  let claimed = 0;
  let skipped = 0;
  const pending: PendingSend[] = [];

  for (const [userId, reason] of byUser) {
    const notificationId = await claimNotification(deps.db, {
      userId,
      eventId,
      reason,
      now,
    });
    if (!notificationId) {
      skipped += 1;
      continue;
    }
    claimed += 1;

    const devices = await loadPushDevicesForUsers(deps.db, [userId]);
    if (devices.length === 0) continue;

    const unread = await countUnreadNotifications(deps.db, userId);
    pending.push({
      notificationId,
      userId,
      devices,
      messages: devices.map((d) => ({
        to: d.expoPushToken,
        data: {
          kind: 'inbox',
          notificationId,
          eventId,
          reason,
          eventTitle: event.title,
        },
        badge: unread,
        _contentAvailable: true,
        priority: 'normal',
      })),
    });
  }

  if (pending.length === 0) {
    return { matched: byUser.size, claimed, sent: 0, skipped };
  }

  const allMessages = pending.flatMap((p) => p.messages);
  const deviceIndex: { pendingIdx: number; deviceIdx: number }[] = [];
  for (let p = 0; p < pending.length; p++) {
    for (let d = 0; d < pending[p]!.devices.length; d++) {
      deviceIndex.push({ pendingIdx: p, deviceIdx: d });
    }
  }

  let tickets;
  try {
    tickets = await deps.expo.send(allMessages);
  } catch (err) {
    // Inbox rows stay — silent push is best-effort.
    console.error('silent expo push failed; inbox rows kept', err);
    return { matched: byUser.size, claimed, sent: 0, skipped };
  }

  const okByPending = new Array(pending.length).fill(false);
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const idx = deviceIndex[i];
    if (!ticket || !idx) continue;
    const device = pending[idx.pendingIdx]!.devices[idx.deviceIdx]!;
    if (ticket.status === 'ok') {
      okByPending[idx.pendingIdx] = true;
      continue;
    }
    const err = ticket.details?.error ?? ticket.message ?? '';
    if (err.includes('DeviceNotRegistered') || err.includes('InvalidCredentials')) {
      await clearExpoPushToken(deps.db, device.deviceId);
    }
  }

  let sent = 0;
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i]!;
    if (okByPending[i]) {
      await markNotificationsPushed(deps.db, [p.notificationId], now);
      sent += 1;
    }
  }

  return { matched: byUser.size, claimed, sent, skipped };
}
