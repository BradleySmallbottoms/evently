import {
  BROADCAST_MATCH_LIMIT,
  bundledPushPresentation,
  PUSH_AGGREGATION_WINDOW_MS,
  type PushBundleItem,
} from '@local-events/domain';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { isPushDryRun, type ExpoPushClient, type ExpoPushMessage } from './expo-push';
import {
  clearExpoPushToken,
  countUnreadNotifications,
  findAreaMatchedUsers,
  findNearbyMatchedUsers,
  findPublisherSubscriberUsers,
  loadPublishedEvent,
  loadPushDevicesForUsers,
  markNotificationsPushed,
  purgeExpiredNotifications,
  type MatchedUser,
} from './match';

export type HandleDuePushDeps = {
  db: Db;
  expo: ExpoPushClient;
  now?: () => Date;
};

const MATCH_LIMIT = 500;

/** Set PUSH_DEBUG=0 to silence. On by default so local delivery failures are visible. */
function pushDebug(payload: Record<string, unknown>): void {
  if (process.env.PUSH_DEBUG === '0') return;
  console.log(JSON.stringify({ duePushDebug: payload }));
}

function tokenHint(token: string): string {
  if (token.length <= 12) return token;
  return `${token.slice(0, 10)}…${token.slice(-6)}`;
}

type NotifyReason = 'nearby' | 'publisher' | 'broadcast';

type PushAudienceKind = 'event_match' | 'everyone' | 'tag_interest' | 'area' | 'area_and_tag';

type DueMessage = {
  id: string;
  eventId: string | null;
  kind: 'event' | 'broadcast';
  audience: PushAudienceKind;
  audienceTagId: string | null;
  titleSv: string;
  bodySv: string;
  titleEn: string;
  bodyEn: string;
  sendAt: Date | null;
};

function mergeUsers(
  nearby: MatchedUser[],
  publisher: MatchedUser[],
): Map<string, NotifyReason> {
  const merged = new Map<string, NotifyReason>();
  for (const u of nearby) merged.set(u.userId, 'nearby');
  for (const u of publisher) {
    if (!merged.has(u.userId)) merged.set(u.userId, 'publisher');
  }
  return merged;
}

const STALE_SENDING_MS = 5 * 60 * 1000;

async function claimDueMessages(db: Db, now: Date): Promise<DueMessage[]> {
  const staleBefore = new Date(now.getTime() - STALE_SENDING_MS);
  // Raw sql`` params skip drizzle's timestamp encoder. postgres-js then
  // refuses Date instances (ERR_INVALID_ARG_TYPE), so bind ISO strings.
  const nowIso = now.toISOString();
  const staleBeforeIso = staleBefore.toISOString();
  // Single statement: lock + claim so two pollers cannot both take the same row.
  const claimed = await db.execute(sql`
    UPDATE push_messages pm
    SET status = 'sending', updated_at = ${nowIso}
    WHERE pm.id IN (
      SELECT pm2.id
      FROM push_messages pm2
      LEFT JOIN events e ON e.id = pm2.event_id
      WHERE (
          pm2.status = 'approved'
          OR (pm2.status = 'sending' AND pm2.updated_at < ${staleBeforeIso})
        )
        AND (pm2.send_at IS NULL OR pm2.send_at <= ${nowIso})
        AND (
          pm2.kind = 'broadcast'
          OR (pm2.kind = 'event' AND e.status = 'published')
        )
      ORDER BY pm2.send_at ASC NULLS FIRST, pm2.id ASC
      LIMIT 20
      FOR UPDATE OF pm2 SKIP LOCKED
    )
    RETURNING pm.id, pm.event_id, pm.kind, pm.audience, pm.audience_tag_id,
      pm.title_sv, pm.body_sv, pm.title_en, pm.body_en, pm.send_at
  `);

  const rows = (Array.isArray(claimed) ? claimed : []) as Array<{
    id: string;
    event_id: string | null;
    kind: 'event' | 'broadcast';
    audience: PushAudienceKind;
    audience_tag_id: string | null;
    title_sv: string;
    body_sv: string;
    title_en: string;
    body_en: string;
    send_at: Date | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    kind: r.kind,
    audience: r.audience,
    audienceTagId: r.audience_tag_id,
    titleSv: r.title_sv,
    bodySv: r.body_sv,
    titleEn: r.title_en,
    bodyEn: r.body_en,
    sendAt: r.send_at ? new Date(r.send_at) : null,
  }));
}

async function audienceForEvent(
  db: Db,
  eventId: string,
): Promise<Map<string, NotifyReason>> {
  const event = await loadPublishedEvent(db, eventId);
  if (!event || event.status !== 'published') return new Map();
  const nearby = event.hasLocation
    ? await findNearbyMatchedUsers(db, eventId, MATCH_LIMIT)
    : [];
  const publisherSubs = await findPublisherSubscriberUsers(
    db,
    event.publisherId,
    MATCH_LIMIT,
  );
  return mergeUsers(nearby, publisherSubs);
}

async function audienceForBroadcast(
  db: Db,
  message: DueMessage,
): Promise<Map<string, NotifyReason>> {
  const out = new Map<string, NotifyReason>();
  if (message.audience === 'everyone') {
    const rows = await db.execute(sql`
      SELECT id AS user_id FROM users
      WHERE banned_at IS NULL
      LIMIT ${BROADCAST_MATCH_LIMIT}
    `);
    for (const r of (Array.isArray(rows) ? rows : []) as Array<{ user_id: string }>) {
      out.set(r.user_id, 'broadcast');
    }
    return out;
  }
  if (message.audience === 'tag_interest' && message.audienceTagId) {
    const rows = await db.execute(sql`
      SELECT DISTINCT ua.user_id
      FROM user_area_tags uat
      INNER JOIN user_areas ua ON ua.id = uat.area_id
      INNER JOIN users u ON u.id = ua.user_id AND u.banned_at IS NULL
      WHERE uat.tag_id = ${message.audienceTagId}::uuid
      LIMIT ${BROADCAST_MATCH_LIMIT}
    `);
    for (const r of (Array.isArray(rows) ? rows : []) as Array<{ user_id: string }>) {
      out.set(r.user_id, 'broadcast');
    }
  }
  return out;
}

/**
 * Admin-picked event audience, plus every follower of the event's publisher.
 * `area` is coverage only. `area_and_tag` also needs a tag on that covering area.
 */
async function audienceForAdminEvent(
  db: Db,
  eventId: string,
  audience: 'area' | 'area_and_tag',
): Promise<Map<string, NotifyReason>> {
  const event = await loadPublishedEvent(db, eventId);
  if (!event || event.status !== 'published') return new Map();
  const matched = !event.hasLocation
    ? []
    : audience === 'area'
      ? await findAreaMatchedUsers(db, eventId, MATCH_LIMIT)
      : await findNearbyMatchedUsers(db, eventId, MATCH_LIMIT);
  const publisherSubs = await findPublisherSubscriberUsers(db, event.publisherId, MATCH_LIMIT);
  return mergeUsers(matched, publisherSubs);
}

async function audienceForMessage(
  db: Db,
  message: DueMessage,
): Promise<Map<string, NotifyReason>> {
  if (message.kind === 'broadcast') return audienceForBroadcast(db, message);
  if (!message.eventId) return new Map();
  if (message.audience === 'area' || message.audience === 'area_and_tag') {
    return audienceForAdminEvent(db, message.eventId, message.audience);
  }
  return audienceForEvent(db, message.eventId);
}

async function loadWindowCandidates(
  db: Db,
  now: Date,
  excludeId: string,
): Promise<DueMessage[]> {
  const windowEnd = new Date(now.getTime() + PUSH_AGGREGATION_WINDOW_MS);
  const rows = await db
    .select({
      id: schema.pushMessages.id,
      eventId: schema.pushMessages.eventId,
      kind: schema.pushMessages.kind,
      audience: schema.pushMessages.audience,
      audienceTagId: schema.pushMessages.audienceTagId,
      titleSv: schema.pushMessages.titleSv,
      bodySv: schema.pushMessages.bodySv,
      titleEn: schema.pushMessages.titleEn,
      bodyEn: schema.pushMessages.bodyEn,
      sendAt: schema.pushMessages.sendAt,
      eventStatus: schema.events.status,
      status: schema.pushMessages.status,
    })
    .from(schema.pushMessages)
    .leftJoin(schema.events, eq(schema.events.id, schema.pushMessages.eventId))
    .where(
      and(
        inArray(schema.pushMessages.status, ['approved', 'sending']),
        sql`${schema.pushMessages.id} <> ${excludeId}::uuid`,
        or(isNull(schema.pushMessages.sendAt), lte(schema.pushMessages.sendAt, windowEnd)),
        or(
          eq(schema.pushMessages.kind, 'broadcast'),
          and(eq(schema.pushMessages.kind, 'event'), eq(schema.events.status, 'published')),
        ),
      ),
    )
    .orderBy(asc(schema.pushMessages.sendAt), asc(schema.pushMessages.id));

  return rows
    .filter((r) => r.id !== excludeId)
    .map((r) => ({
      id: r.id,
      eventId: r.eventId,
      kind: r.kind,
      audience: r.audience,
      audienceTagId: r.audienceTagId,
      titleSv: r.titleSv,
      bodySv: r.bodySv,
      titleEn: r.titleEn,
      bodyEn: r.bodyEn,
      sendAt: r.sendAt,
    }));
}

async function upsertDelivery(
  db: Db,
  input: {
    pushMessageId: string;
    userId: string;
    status: 'pending' | 'deferred' | 'sent' | 'dry_run';
    deferredUntilMessageId?: string | null;
    sentAt?: Date | null;
  },
): Promise<void> {
  await db
    .insert(schema.pushMessageDeliveries)
    .values({
      pushMessageId: input.pushMessageId,
      userId: input.userId,
      status: input.status,
      deferredUntilMessageId: input.deferredUntilMessageId ?? null,
      sentAt: input.sentAt ?? null,
    })
    .onConflictDoUpdate({
      target: [
        schema.pushMessageDeliveries.pushMessageId,
        schema.pushMessageDeliveries.userId,
      ],
      set: {
        status: input.status,
        deferredUntilMessageId: input.deferredUntilMessageId ?? null,
        sentAt: input.sentAt ?? null,
      },
    });
}

/** Collect deferred messages that wait on `messageId`, including earlier hops (A→B→C). */
async function loadDeferredWaitingFor(
  db: Db,
  userId: string,
  messageId: string,
): Promise<DueMessage[]> {
  const collected = new Map<string, DueMessage>();
  let frontier = [messageId];
  while (frontier.length > 0) {
    const rows = await db
      .select({
        id: schema.pushMessages.id,
        eventId: schema.pushMessages.eventId,
        kind: schema.pushMessages.kind,
        audience: schema.pushMessages.audience,
        audienceTagId: schema.pushMessages.audienceTagId,
        titleSv: schema.pushMessages.titleSv,
        bodySv: schema.pushMessages.bodySv,
        titleEn: schema.pushMessages.titleEn,
        bodyEn: schema.pushMessages.bodyEn,
        sendAt: schema.pushMessages.sendAt,
      })
      .from(schema.pushMessageDeliveries)
      .innerJoin(
        schema.pushMessages,
        eq(schema.pushMessages.id, schema.pushMessageDeliveries.pushMessageId),
      )
      .where(
        and(
          eq(schema.pushMessageDeliveries.userId, userId),
          eq(schema.pushMessageDeliveries.status, 'deferred'),
          inArray(schema.pushMessageDeliveries.deferredUntilMessageId, frontier),
        ),
      );
    frontier = [];
    for (const r of rows) {
      if (collected.has(r.id)) continue;
      collected.set(r.id, {
        id: r.id,
        eventId: r.eventId,
        kind: r.kind,
        audience: r.audience,
        audienceTagId: r.audienceTagId,
        titleSv: r.titleSv,
        bodySv: r.bodySv,
        titleEn: r.titleEn,
        bodyEn: r.bodyEn,
        sendAt: r.sendAt,
      });
      frontier.push(r.id);
    }
  }
  return [...collected.values()];
}

async function claimInbox(
  db: Db,
  input: {
    userId: string;
    eventId: string | null;
    pushMessageId: string;
    reason: NotifyReason;
    now: Date;
  },
): Promise<string | null> {
  const inserted = await db
    .insert(schema.notifications)
    .values({
      userId: input.userId,
      eventId: input.eventId,
      pushMessageId: input.pushMessageId,
      reason: input.reason,
      sentAt: input.now,
      pushState: 'pending',
    })
    .onConflictDoNothing()
    .returning({ id: schema.notifications.id });
  return inserted[0]?.id ?? null;
}

async function deliverBundleToUser(
  deps: HandleDuePushDeps,
  input: {
    userId: string;
    bundle: DueMessage[];
    reasons: Map<string, NotifyReason>;
    now: Date;
  },
): Promise<number> {
  const notificationIds: string[] = [];
  for (const msg of input.bundle) {
    const reason = input.reasons.get(msg.id) ?? 'nearby';
    const id = await claimInbox(deps.db, {
      userId: input.userId,
      eventId: msg.eventId,
      pushMessageId: msg.id,
      reason,
      now: input.now,
    });
    if (id) notificationIds.push(id);
  }

  const devices = await loadPushDevicesForUsers(deps.db, [input.userId]);
  const dryRun = isPushDryRun();
  for (const msg of input.bundle) {
    await upsertDelivery(deps.db, {
      pushMessageId: msg.id,
      userId: input.userId,
      status: dryRun ? 'dry_run' : 'sent',
      deferredUntilMessageId: null,
      sentAt: input.now,
    });
  }

  pushDebug({
    step: 'deliver',
    userId: input.userId,
    bundleIds: input.bundle.map((m) => m.id),
    inboxInserted: notificationIds.length,
    deviceCount: devices.length,
    tokens: devices.map((d) => ({
      deviceId: d.deviceId,
      locale: d.locale,
      token: tokenHint(d.expoPushToken),
    })),
  });

  if (devices.length === 0) {
    pushDebug({
      step: 'skip_no_token',
      userId: input.userId,
      note: 'inbox row kept; no expo_push_token on active devices for this user',
    });
    if (notificationIds.length > 0) {
      await markNotificationsPushed(deps.db, notificationIds, input.now);
    }
    return 0;
  }

  if (dryRun) {
    console.log(
      JSON.stringify({
        pushDryRun: true,
        step: 'delivery_recorded',
        userId: input.userId,
        pushMessageIds: input.bundle.map((m) => m.id),
        deviceCount: devices.length,
        note: 'push_message_deliveries status dry_run; Expo not called',
      }),
    );
    return 1;
  }

  const unread = await countUnreadNotifications(deps.db, input.userId);
  const bundleItems: PushBundleItem[] = input.bundle.map((m) => ({
    id: m.id,
    sendAt: m.sendAt,
    titleSv: m.titleSv,
    bodySv: m.bodySv,
    titleEn: m.titleEn,
    bodyEn: m.bodyEn,
  }));
  const primary = input.bundle[0]!;
  const messages: ExpoPushMessage[] = devices.map((d) => {
    const presentation = bundledPushPresentation(d.locale, bundleItems);
    return {
      to: d.expoPushToken,
      data: {
        kind: 'inbox',
        notificationId: notificationIds[0] ?? '',
        eventId: primary.eventId ?? '',
        reason: input.reasons.get(primary.id) ?? 'nearby',
        eventTitle: presentation.title,
        moreCount: String(presentation.moreCount),
        eventIds: input.bundle.flatMap((b) => (b.eventId ? [b.eventId] : [])).join(','),
        // Client may use title/body from data when presenting local OS notification.
        title: presentation.title,
        body: presentation.body,
      },
      badge: unread,
      _contentAvailable: true,
      priority: 'normal',
    };
  });

  pushDebug({
    step: 'expo_send',
    userId: input.userId,
    messageCount: messages.length,
    silent: true,
    title: messages[0]?.data?.title,
    body: messages[0]?.data?.body,
  });

  let tickets;
  try {
    tickets = await deps.expo.send(messages);
  } catch (err) {
    console.error('expo push failed; inbox rows kept', err);
    pushDebug({
      step: 'expo_send_error',
      userId: input.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }

  let ok = false;
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const device = devices[i];
    if (!ticket || !device) continue;
    if (ticket.status === 'ok') {
      ok = true;
      pushDebug({
        step: 'expo_ticket_ok',
        userId: input.userId,
        deviceId: device.deviceId,
        ticketId: ticket.id ?? null,
        token: tokenHint(device.expoPushToken),
      });
      continue;
    }
    const err = ticket.details?.error ?? ticket.message ?? '';
    pushDebug({
      step: 'expo_ticket_error',
      userId: input.userId,
      deviceId: device.deviceId,
      token: tokenHint(device.expoPushToken),
      status: ticket.status,
      message: ticket.message ?? null,
      error: ticket.details?.error ?? null,
    });
    if (err.includes('DeviceNotRegistered') || err.includes('InvalidCredentials')) {
      await clearExpoPushToken(deps.db, device.deviceId);
      pushDebug({ step: 'token_cleared', deviceId: device.deviceId, reason: err });
    }
  }
  if (ok && notificationIds.length > 0) {
    await markNotificationsPushed(deps.db, notificationIds, input.now);
  }
  pushDebug({
    step: 'deliver_done',
    userId: input.userId,
    expoOk: ok,
    note: ok
      ? 'silent/data push accepted by Expo; OS banner only if mobile presents a local notification'
      : 'no successful Expo tickets',
  });
  return ok ? 1 : 0;
}

async function processMessage(
  deps: HandleDuePushDeps,
  message: DueMessage,
  now: Date,
): Promise<{ matched: number; sent: number; deferred: number }> {
  pushDebug({
    step: 'process',
    pushMessageId: message.id,
    kind: message.kind,
    audience: message.audience,
    audienceTagId: message.audienceTagId,
    eventId: message.eventId,
    sendAt: message.sendAt?.toISOString() ?? null,
    titleSv: message.titleSv,
  });

  const audience = await audienceForMessage(deps.db, message);
  pushDebug({
    step: 'audience',
    pushMessageId: message.id,
    matched: audience.size,
    sampleUserIds: [...audience.keys()].slice(0, 5),
    reasons: Object.fromEntries(
      [...audience.entries()].slice(0, 5).map(([uid, reason]) => [uid, reason]),
    ),
  });

  const windowCandidates = await loadWindowCandidates(deps.db, now, message.id);
  const candidateAudiences = new Map<string, Map<string, NotifyReason>>();
  for (const c of windowCandidates) {
    candidateAudiences.set(c.id, await audienceForMessage(deps.db, c));
  }
  pushDebug({
    step: 'aggregation_window',
    pushMessageId: message.id,
    windowCandidateCount: windowCandidates.length,
    windowCandidateIds: windowCandidates.map((c) => c.id).slice(0, 10),
  });

  let sent = 0;
  let deferred = 0;
  let skippedAlreadySent = 0;

  for (const [userId, reason] of audience) {
    const [existing] = await deps.db
      .select({ status: schema.pushMessageDeliveries.status })
      .from(schema.pushMessageDeliveries)
      .where(
        and(
          eq(schema.pushMessageDeliveries.pushMessageId, message.id),
          eq(schema.pushMessageDeliveries.userId, userId),
        ),
      )
      .limit(1);
    if (existing?.status === 'sent' || existing?.status === 'dry_run') {
      skippedAlreadySent += 1;
      pushDebug({
        step: 'skip_already_sent',
        pushMessageId: message.id,
        userId,
        status: existing.status,
      });
      continue;
    }

    const later = windowCandidates.find((c) => {
      const aud = candidateAudiences.get(c.id);
      if (!aud?.has(userId)) return false;
      const due = c.sendAt?.getTime() ?? now.getTime();
      const selfDue = message.sendAt?.getTime() ?? now.getTime();
      if (due < selfDue) return false;
      if (due === selfDue && c.id <= message.id) return false;
      return due <= now.getTime() + PUSH_AGGREGATION_WINDOW_MS;
    });

    if (later) {
      await upsertDelivery(deps.db, {
        pushMessageId: message.id,
        userId,
        status: 'deferred',
        deferredUntilMessageId: later.id,
      });
      deferred += 1;
      pushDebug({
        step: 'deferred',
        pushMessageId: message.id,
        userId,
        untilMessageId: later.id,
      });
      continue;
    }

    const waiting = await loadDeferredWaitingFor(deps.db, userId, message.id);
    const bundle = [...waiting, message].sort((a, b) => {
      const aAt = a.sendAt?.getTime() ?? 0;
      const bAt = b.sendAt?.getTime() ?? 0;
      if (aAt !== bAt) return aAt - bAt;
      return a.id.localeCompare(b.id);
    });

    const reasons = new Map<string, NotifyReason>();
    reasons.set(message.id, reason);
    for (const w of waiting) {
      const aud = await audienceForMessage(deps.db, w);
      reasons.set(w.id, aud.get(userId) ?? (w.kind === 'broadcast' ? 'broadcast' : 'nearby'));
    }

    pushDebug({
      step: 'deliver_user',
      pushMessageId: message.id,
      userId,
      reason,
      bundleSize: bundle.length,
      waitingCount: waiting.length,
    });
    sent += await deliverBundleToUser(deps, { userId, bundle, reasons, now });
  }

  await deps.db
    .update(schema.pushMessages)
    .set({ status: 'sent', sentAt: now, updatedAt: now })
    .where(eq(schema.pushMessages.id, message.id));

  pushDebug({
    step: 'process_done',
    pushMessageId: message.id,
    matched: audience.size,
    sent,
    deferred,
    skippedAlreadySent,
  });

  return { matched: audience.size, sent, deferred };
}

/**
 * Deliver deferred rows whose target was cancelled/rejected/missing.
 * Do not flush when the target is merely `sent` — that message may have
 * re-deferred the user to a later hop still in flight.
 */
async function flushOrphanDeferred(deps: HandleDuePushDeps, now: Date): Promise<number> {
  const rows = await deps.db.execute(sql`
    SELECT d.push_message_id, d.user_id, d.deferred_until_message_id
    FROM push_message_deliveries d
    LEFT JOIN push_messages target ON target.id = d.deferred_until_message_id
    WHERE d.status = 'deferred'
      AND (
        d.deferred_until_message_id IS NULL
        OR target.id IS NULL
        OR target.status IN ('cancelled', 'rejected')
      )
    LIMIT 100
  `);
  const list = (Array.isArray(rows) ? rows : []) as Array<{
    push_message_id: string;
    user_id: string;
    deferred_until_message_id: string | null;
  }>;
  let flushed = 0;
  for (const row of list) {
    const [msg] = await deps.db
      .select()
      .from(schema.pushMessages)
      .where(eq(schema.pushMessages.id, row.push_message_id))
      .limit(1);
    if (!msg) continue;
    const due: DueMessage = {
      id: msg.id,
      eventId: msg.eventId,
      kind: msg.kind,
      audience: msg.audience,
      audienceTagId: msg.audienceTagId,
      titleSv: msg.titleSv,
      bodySv: msg.bodySv,
      titleEn: msg.titleEn,
      bodyEn: msg.bodyEn,
      sendAt: msg.sendAt,
    };
    if (due.kind === 'event') {
      if (!due.eventId) continue;
      const event = await loadPublishedEvent(deps.db, due.eventId);
      if (!event || event.status !== 'published') continue;
    }
    const aud = await audienceForMessage(deps.db, due);
    const reason = aud.get(row.user_id) ?? (due.kind === 'broadcast' ? 'broadcast' : 'nearby');
    flushed += await deliverBundleToUser(deps, {
      userId: row.user_id,
      bundle: [due],
      reasons: new Map([[msg.id, reason]]),
      now,
    });
  }
  return flushed;
}

/**
 * Poll due approved push messages, aggregate per user within 10 minutes,
 * write inbox rows and send silent Expo pushes.
 */
export async function handleDuePushMessages(
  deps: HandleDuePushDeps,
): Promise<{ claimed: number; matched: number; sent: number; deferred: number; orphans: number }> {
  const now = deps.now?.() ?? new Date();
  const purged = await purgeExpiredNotifications(deps.db, now);
  if (purged > 0) {
    console.log(JSON.stringify({ purge: 'notifications', deleted: purged }));
  }

  const claimed = await claimDueMessages(deps.db, now);
  pushDebug({
    step: 'claim',
    now: now.toISOString(),
    claimed: claimed.length,
    messages: claimed.map((m) => ({
      id: m.id,
      kind: m.kind,
      audience: m.audience,
      eventId: m.eventId,
      sendAt: m.sendAt?.toISOString() ?? null,
    })),
  });
  let matched = 0;
  let sent = 0;
  let deferred = 0;
  for (const message of claimed) {
    const result = await processMessage(deps, message, now);
    matched += result.matched;
    sent += result.sent;
    deferred += result.deferred;
  }
  const orphans = await flushOrphanDeferred(deps, now);
  if (orphans > 0) {
    pushDebug({ step: 'orphans_flushed', orphans });
  }
  return { claimed: claimed.length, matched, sent, deferred, orphans };
}
