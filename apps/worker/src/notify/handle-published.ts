import {
  aggregatePushCopy,
  canSendUnderDailyCap,
  DAILY_NOTIFICATION_CAP,
  isWithinQuietHours,
  localDayKey,
} from '@local-events/domain';
import type { Db } from '@local-events/db';
import { sql } from 'drizzle-orm';
import type { ExpoPushClient, ExpoPushMessage } from './expo-push';
import {
  claimNotification,
  clearExpoPushToken,
  findNearbyCandidates,
  findPublisherSubscriberCandidates,
  loadPendingPushCandidates,
  loadPublishedEvent,
  loadRecentNotificationCounts,
  markNotificationsPushed,
  releaseNotificationClaim,
  type NearbyCandidate,
} from './match';

export type HandlePublishedDeps = {
  db: Db;
  expo: ExpoPushClient;
  now?: () => Date;
};

const MATCH_LIMIT = 500;

type NotifyReason = 'nearby' | 'publisher';

function pushCopy(
  locale: string,
  title: string,
  reason: NotifyReason,
): { title: string; body: string } {
  if (locale.startsWith('en')) {
    return {
      title,
      body: reason === 'publisher' ? 'A followed publisher posted a new event' : 'A new event near you',
    };
  }
  return {
    title,
    body:
      reason === 'publisher'
        ? 'En följd arrangör publicerade ett evenemang'
        : 'Ett nytt evenemang nära dig',
  };
}

function groupByUser(candidates: NearbyCandidate[]): Map<string, NearbyCandidate[]> {
  const map = new Map<string, NearbyCandidate[]>();
  for (const c of candidates) {
    const list = map.get(c.userId) ?? [];
    list.push(c);
    map.set(c.userId, list);
  }
  return map;
}

/** Nearby wins when a user matches both paths — one push per event. */
function mergeCandidates(
  nearby: NearbyCandidate[],
  publisher: NearbyCandidate[],
): Map<string, { devices: NearbyCandidate[]; reason: NotifyReason }> {
  const nearbyByUser = groupByUser(nearby);
  const publisherByUser = groupByUser(publisher);
  const merged = new Map<string, { devices: NearbyCandidate[]; reason: NotifyReason }>();
  for (const [userId, devices] of nearbyByUser) {
    merged.set(userId, { devices, reason: 'nearby' });
  }
  for (const [userId, devices] of publisherByUser) {
    if (!merged.has(userId)) {
      merged.set(userId, { devices, reason: 'publisher' });
    }
  }
  return merged;
}

type PendingSend = {
  userId: string;
  claimIds: string[];
  devices: NearbyCandidate[];
  messages: ExpoPushMessage[];
  pushState: 'sent' | 'aggregated';
};

async function claimUnderDailyCap(
  db: Db,
  input: {
    userId: string;
    eventId: string;
    reason: NotifyReason;
    timezone: string;
    day: string;
    now: Date;
    stagedExtra: number;
  },
): Promise<string | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`);
    const fresh = await loadRecentNotificationCounts(tx, [input.userId], input.now);
    const sentToday = (fresh.get(input.userId) ?? []).filter(
      (r) => localDayKey(r.sentAt, input.timezone) === input.day,
    ).length;
    if (!canSendUnderDailyCap(sentToday + input.stagedExtra, DAILY_NOTIFICATION_CAP)) {
      return null;
    }
    return claimNotification(tx, {
      userId: input.userId,
      eventId: input.eventId,
      reason: input.reason,
      now: input.now,
    });
  });
}

/**
 * After quiet hours: one aggregate Expo per user for all still-pending inbox rows.
 */
export async function flushQuietHoursAggregates(
  deps: HandlePublishedDeps,
): Promise<{ users: number; notifications: number }> {
  const now = deps.now?.() ?? new Date();
  const pending = await loadPendingPushCandidates(deps.db);
  const byUser = new Map<
    string,
    {
      notificationIds: Set<string>;
      devices: Map<string, NearbyCandidate>;
      locale: string;
      prefs: {
        enabled: boolean;
        timezone: string;
        startMin: number;
        endMin: number;
      };
    }
  >();

  for (const row of pending) {
    const prefs = {
      enabled: row.quietHoursEnabled,
      timezone: row.timezone,
      startMin: row.quietHoursStartMin,
      endMin: row.quietHoursEndMin,
    };
    if (isWithinQuietHours(now, prefs)) continue;
    let bucket = byUser.get(row.userId);
    if (!bucket) {
      bucket = {
        notificationIds: new Set(),
        devices: new Map(),
        locale: row.locale,
        prefs,
      };
      byUser.set(row.userId, bucket);
    }
    bucket.notificationIds.add(row.notificationId);
    bucket.devices.set(row.deviceId, {
      userId: row.userId,
      deviceId: row.deviceId,
      expoPushToken: row.expoPushToken,
      locale: row.locale,
      timezone: row.timezone,
      quietHoursStartMin: row.quietHoursStartMin,
      quietHoursEndMin: row.quietHoursEndMin,
      quietHoursEnabled: row.quietHoursEnabled,
    });
  }

  let notificationCount = 0;
  for (const [, bucket] of byUser) {
    const ids = [...bucket.notificationIds];
    const copy = aggregatePushCopy(bucket.locale, ids.length);
    const devices = [...bucket.devices.values()];
    const messages: ExpoPushMessage[] = devices.map((d) => ({
      to: d.expoPushToken,
      title: copy.title,
      body: copy.body,
      data: { kind: 'quiet_hours_aggregate', count: ids.length },
      sound: 'default' as const,
    }));
    try {
      const tickets = await deps.expo.send(messages);
      let anyOk = false;
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const device = devices[i];
        if (!ticket || !device) continue;
        if (ticket.status === 'ok') {
          anyOk = true;
          continue;
        }
        const err = ticket.details?.error ?? ticket.message ?? '';
        if (err.includes('DeviceNotRegistered') || err.includes('InvalidCredentials')) {
          await clearExpoPushToken(deps.db, device.deviceId);
        }
      }
      if (anyOk) {
        await markNotificationsPushed(deps.db, ids, 'aggregated', now);
        notificationCount += ids.length;
      }
    } catch (err) {
      console.error('quiet-hours aggregate flush failed', err);
    }
  }

  return { users: byUser.size, notifications: notificationCount };
}

/**
 * Fan out push for a published event: nearby geo match + publisher followers.
 * Quiet hours: claim inbox row as pending (no Expo); flush aggregates when the window ends.
 * Idempotent via notifications unique (user, event, reason).
 */
export async function handleEventPublished(
  eventId: string,
  deps: HandlePublishedDeps,
): Promise<{ matched: number; sent: number; skipped: number; deferred: number }> {
  const now = deps.now?.() ?? new Date();
  await flushQuietHoursAggregates(deps);

  const event = await loadPublishedEvent(deps.db, eventId);
  if (!event || event.status !== 'published') {
    return { matched: 0, sent: 0, skipped: 0, deferred: 0 };
  }

  const nearby = event.hasLocation
    ? await findNearbyCandidates(deps.db, eventId, MATCH_LIMIT)
    : [];
  const publisherSubs = await findPublisherSubscriberCandidates(
    deps.db,
    event.publisherId,
    MATCH_LIMIT,
  );
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
  const byUser = mergeCandidates(nearby, publisherSubs);
  const recent = await loadRecentNotificationCounts(deps.db, [...byUser.keys()], now);

  let skipped = 0;
  let deferred = 0;
  const pending: PendingSend[] = [];
  const stagedClaims = new Map<string, number>();

  for (const [userId, { devices, reason }] of byUser) {
    const sample = devices[0]!;
    const prefs = {
      enabled: sample.quietHoursEnabled,
      timezone: sample.timezone,
      startMin: sample.quietHoursStartMin,
      endMin: sample.quietHoursEndMin,
    };
    const inQuietHours = isWithinQuietHours(now, prefs);

    const day = localDayKey(now, sample.timezone);
    const claimId = await claimUnderDailyCap(deps.db, {
      userId,
      eventId,
      reason,
      timezone: sample.timezone,
      day,
      now,
      stagedExtra: stagedClaims.get(userId) ?? 0,
    });

    if (!claimId) {
      skipped += 1;
      continue;
    }

    stagedClaims.set(userId, (stagedClaims.get(userId) ?? 0) + 1);
    const list = recent.get(userId) ?? [];
    list.push({ sentAt: now });
    recent.set(userId, list);

    if (inQuietHours) {
      deferred += 1;
      continue;
    }

    const copy = pushCopy(sample.locale, event.title, reason);
    pending.push({
      userId,
      claimIds: [claimId],
      devices,
      pushState: 'sent',
      messages: devices.map((d) => ({
        to: d.expoPushToken,
        title: copy.title,
        body: copy.body,
        data: { eventId, reason },
        sound: 'default' as const,
      })),
    });
  }

  if (pending.length === 0) {
    return { matched: byUser.size, sent: 0, skipped, deferred };
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
    await Promise.all(pending.flatMap((p) => p.claimIds.map((id) => releaseNotificationClaim(deps.db, id))));
    throw err;
  }

  if (tickets.length === 0) {
    await Promise.all(pending.flatMap((p) => p.claimIds.map((id) => releaseNotificationClaim(deps.db, id))));
    return { matched: byUser.size, sent: 0, skipped: skipped + pending.length, deferred };
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
      await markNotificationsPushed(deps.db, p.claimIds, p.pushState, now);
      sent += 1;
    } else {
      await Promise.all(p.claimIds.map((id) => releaseNotificationClaim(deps.db, id)));
      skipped += 1;
    }
  }

  return { matched: byUser.size, sent, skipped, deferred };
}
