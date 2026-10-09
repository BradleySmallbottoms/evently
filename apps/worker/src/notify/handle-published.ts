import {
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
  loadPublishedEvent,
  loadRecentNotificationCounts,
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
  claimId: string;
  devices: NearbyCandidate[];
  messages: ExpoPushMessage[];
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
 * Fan out push for a published event: nearby geo match + publisher followers.
 * Idempotent via notifications unique (user, event, reason).
 */
export async function handleEventPublished(
  eventId: string,
  deps: HandlePublishedDeps,
): Promise<{ matched: number; sent: number; skipped: number }> {
  const now = deps.now?.() ?? new Date();
  const event = await loadPublishedEvent(deps.db, eventId);
  if (!event || event.status !== 'published') {
    return { matched: 0, sent: 0, skipped: 0 };
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
  const pending: PendingSend[] = [];

  for (const [userId, { devices, reason }] of byUser) {
    const sample = devices[0]!;
    const prefs = {
      enabled: sample.quietHoursEnabled,
      timezone: sample.timezone,
      startMin: sample.quietHoursStartMin,
      endMin: sample.quietHoursEndMin,
    };
    if (isWithinQuietHours(now, prefs)) {
      // Spec (docs/decisions.md): store in inbox + aggregate Expo after the window.
      // Current implementation still drops the push; inbox deferral is a planned Phase 3 follow-up.
      skipped += 1;
      continue;
    }

    const day = localDayKey(now, sample.timezone);
    const claimId = await claimUnderDailyCap(deps.db, {
      userId,
      eventId,
      reason,
      timezone: sample.timezone,
      day,
      now,
      stagedExtra: pending.filter((p) => p.userId === userId).length,
    });

    if (!claimId) {
      skipped += 1;
      continue;
    }

    const list = recent.get(userId) ?? [];
    list.push({ sentAt: now });
    recent.set(userId, list);

    const copy = pushCopy(sample.locale, event.title, reason);
    pending.push({
      userId,
      claimId,
      devices,
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
    return { matched: byUser.size, sent: 0, skipped };
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
    await Promise.all(pending.map((p) => releaseNotificationClaim(deps.db, p.claimId)));
    throw err;
  }

  if (tickets.length === 0) {
    await Promise.all(pending.map((p) => releaseNotificationClaim(deps.db, p.claimId)));
    return { matched: byUser.size, sent: 0, skipped: skipped + pending.length };
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
      sent += 1;
    } else {
      await releaseNotificationClaim(deps.db, p.claimId);
      skipped += 1;
    }
  }

  return { matched: byUser.size, sent, skipped };
}
