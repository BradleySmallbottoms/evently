import type {
  CheckIn,
  CreateCodeCheckInRequest,
  CreateGeoCheckInRequest,
  DigitalCodeSessionResponse,
} from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import {
  checkInWindow,
  DIGITAL_CODE_SLOT_SECONDS,
  digitalCheckInQrPayload,
  digitalCodeSlot,
  FOR_YOU_RECENT_LIMIT,
  validateCodeCheckIn,
  validateGeoCheckIn,
} from '@local-events/domain';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { requirePublisherId } from '../publisher-id';
import { createMemoryDomainEventPublisher } from '../domain-events/memory';
import { enqueueDomainEvent } from '../domain-events/types';
import { deriveDigitalCode, generateDigitalCodeSecret, validCodesForNow } from './codes';
import { CheckInError, type CheckInEnv, type CheckInServices } from './types';

const DEFAULT_GEOFENCE_RADIUS_M = 100;

export function createDbCheckInServices(
  db: Db,
  auth: AuthServices,
  env: CheckInEnv = {},
): CheckInServices {
  const now = env.now ?? (() => new Date());
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();

  async function requireUser(sessionToken: string | undefined) {
    try {
      return await auth.requireUserSession(sessionToken);
    } catch (err) {
      if (err instanceof AuthError) throw new CheckInError('unauthorized');
      throw err;
    }
  }

  async function loadPublished(eventId: string) {
    const [row] = await db
      .select({
        id: schema.events.id,
        publisherId: schema.events.publisherId,
        mode: schema.events.mode,
        status: schema.events.status,
        startsAt: schema.events.startsAt,
        endsAt: schema.events.endsAt,
        geofenceRadiusM: schema.events.geofenceRadiusM,
        lat: sql<number | null>`ST_Y(${schema.events.location}::geometry)`,
        lng: sql<number | null>`ST_X(${schema.events.location}::geometry)`,
        hasLocation: sql<boolean>`${schema.events.location} IS NOT NULL`,
        checkInEnabled: schema.events.checkInEnabled,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!row || row.status !== 'published') throw new CheckInError('not_found');
    if (!row.checkInEnabled) throw new CheckInError('check_in_disabled');
    return row;
  }

  async function ensureCodeRow(eventId: string) {
    const [existing] = await db
      .select()
      .from(schema.digitalCodes)
      .where(eq(schema.digitalCodes.eventId, eventId))
      .limit(1);
    if (existing) return existing;
    const [created] = await db
      .insert(schema.digitalCodes)
      .values({
        eventId,
        secret: generateDigitalCodeSecret(),
        rotationS: DIGITAL_CODE_SLOT_SECONDS,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [again] = await db
      .select()
      .from(schema.digitalCodes)
      .where(eq(schema.digitalCodes.eventId, eventId))
      .limit(1);
    if (!again) throw new CheckInError('not_found');
    return again;
  }

  function sessionFromRow(
    eventId: string,
    row: { secret: string; revealedAt: Date | null; rotationS: number },
    at: Date,
  ): DigitalCodeSessionResponse {
    if (!row.revealedAt) {
      return {
        eventId,
        revealed: false,
        code: null,
        qrPayload: null,
        slotEndsAt: null,
        rotationS: row.rotationS,
      };
    }
    const slot = digitalCodeSlot(at);
    const code = deriveDigitalCode(row.secret, slot);
    const slotEndsAt = new Date((slot + 1) * row.rotationS * 1000);
    return {
      eventId,
      revealed: true,
      code,
      qrPayload: digitalCheckInQrPayload(eventId, code),
      slotEndsAt: slotEndsAt.toISOString(),
      rotationS: row.rotationS,
    };
  }

  async function insertCodeCheckIn(userId: string, eventId: string, createdAt: Date) {
    try {
      const rows = await db
        .insert(schema.checkIns)
        .values({
          userId,
          eventId,
          method: 'code',
          createdAt,
        })
        .returning({
          id: schema.checkIns.id,
          userId: schema.checkIns.userId,
          eventId: schema.checkIns.eventId,
          method: schema.checkIns.method,
          createdAt: schema.checkIns.createdAt,
        });
      return rows[0];
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === '23505') throw new CheckInError('already_checked_in');
      throw err;
    }
  }

  return {
    async listMine(sessionToken) {
      const { userId } = await requireUser(sessionToken);
      const rows = await db
        .select({
          eventId: schema.checkIns.eventId,
          publisherId: schema.events.publisherId,
          createdAt: schema.checkIns.createdAt,
        })
        .from(schema.checkIns)
        .innerJoin(schema.events, eq(schema.events.id, schema.checkIns.eventId))
        .where(eq(schema.checkIns.userId, userId))
        .orderBy(desc(schema.checkIns.createdAt))
        .limit(FOR_YOU_RECENT_LIMIT);
      if (rows.length === 0) return { items: [] };
      const tagRows = await db
        .select({ eventId: schema.eventTags.eventId, tagId: schema.eventTags.tagId })
        .from(schema.eventTags)
        .where(
          inArray(
            schema.eventTags.eventId,
            rows.map((row) => row.eventId),
          ),
        );
      const tagsByEvent = new Map<string, string[]>();
      for (const tag of tagRows) {
        const list = tagsByEvent.get(tag.eventId) ?? [];
        list.push(tag.tagId);
        tagsByEvent.set(tag.eventId, list);
      }
      return {
        items: rows.flatMap((row) => {
          if (!row.publisherId) return [];
          return [
            {
              eventId: row.eventId,
              publisherId: row.publisherId,
              tagIds: tagsByEvent.get(row.eventId) ?? [],
              createdAt: row.createdAt.toISOString(),
            },
          ];
        }),
      };
    },

    async getStatus(sessionToken, eventId) {
      const { userId } = await requireUser(sessionToken);
      const row = await loadPublished(eventId);
      const window = checkInWindow({ startsAt: row.startsAt, endsAt: row.endsAt });
      const at = now();
      const [existing] = await db
        .select({ id: schema.checkIns.id })
        .from(schema.checkIns)
        .where(
          and(eq(schema.checkIns.userId, userId), eq(schema.checkIns.eventId, eventId)),
        )
        .limit(1);
      const [codeRow] = await db
        .select({ revealedAt: schema.digitalCodes.revealedAt })
        .from(schema.digitalCodes)
        .where(eq(schema.digitalCodes.eventId, eventId))
        .limit(1);
      return {
        checkedIn: Boolean(existing),
        open: at >= window.opensAt && at <= window.closesAt,
        opensAt: window.opensAt.toISOString(),
        closesAt: window.closesAt.toISOString(),
        codeActive: Boolean(codeRow?.revealedAt),
      };
    },

    async createGeo(sessionToken, eventId, input: CreateGeoCheckInRequest) {
      const { userId } = await requireUser(sessionToken);
      const row = await loadPublished(eventId);
      if (row.mode !== 'physical' || !row.hasLocation || row.lat == null || row.lng == null) {
        throw new CheckInError('not_physical');
      }
      const [existing] = await db
        .select({ id: schema.checkIns.id })
        .from(schema.checkIns)
        .where(
          and(eq(schema.checkIns.userId, userId), eq(schema.checkIns.eventId, eventId)),
        )
        .limit(1);

      const result = validateGeoCheckIn({
        event: {
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          geofenceCenter: { lat: Number(row.lat), lng: Number(row.lng) },
          geofenceRadiusM: row.geofenceRadiusM ?? DEFAULT_GEOFENCE_RADIUS_M,
        },
        location: input.location,
        accuracyM: input.accuracyM,
        alreadyCheckedIn: Boolean(existing),
        now: now(),
      });
      if (!result.ok) throw new CheckInError(result.reason);

      const createdAt = now();
      let inserted: {
        id: string;
        userId: string;
        eventId: string;
        method: 'geo' | 'code';
        createdAt: Date;
      } | undefined;
      try {
        const rows = await db
          .insert(schema.checkIns)
          .values({
            userId,
            eventId,
            method: 'geo',
            lat: input.location.lat,
            lng: input.location.lng,
            accuracyM: Math.round(input.accuracyM),
            createdAt,
          })
          .returning({
            id: schema.checkIns.id,
            userId: schema.checkIns.userId,
            eventId: schema.checkIns.eventId,
            method: schema.checkIns.method,
            createdAt: schema.checkIns.createdAt,
          });
        inserted = rows[0];
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === '23505') throw new CheckInError('already_checked_in');
        throw err;
      }
      if (!inserted) throw new CheckInError('already_checked_in');

      await enqueueDomainEvent(domainEvents, {
        type: 'checkin.created',
        eventId,
        userId,
      });

      return {
        id: inserted.id,
        eventId: inserted.eventId,
        userId: inserted.userId,
        method: inserted.method,
        createdAt: inserted.createdAt.toISOString(),
      } satisfies CheckIn;
    },

    async createCode(sessionToken, eventId, input: CreateCodeCheckInRequest) {
      const { userId } = await requireUser(sessionToken);
      const row = await loadPublished(eventId);
      const [existing] = await db
        .select({ id: schema.checkIns.id })
        .from(schema.checkIns)
        .where(
          and(eq(schema.checkIns.userId, userId), eq(schema.checkIns.eventId, eventId)),
        )
        .limit(1);
      const [codeRow] = await db
        .select()
        .from(schema.digitalCodes)
        .where(eq(schema.digitalCodes.eventId, eventId))
        .limit(1);
      const at = now();
      const result = validateCodeCheckIn({
        event: { startsAt: row.startsAt, endsAt: row.endsAt },
        revealed: Boolean(codeRow?.revealedAt),
        validCodes: codeRow ? validCodesForNow(codeRow.secret, at) : [],
        code: input.code,
        alreadyCheckedIn: Boolean(existing),
        now: at,
      });
      if (!result.ok) throw new CheckInError(result.reason);

      const inserted = await insertCodeCheckIn(userId, eventId, at);
      if (!inserted) throw new CheckInError('already_checked_in');

      await enqueueDomainEvent(domainEvents, {
        type: 'checkin.created',
        eventId,
        userId,
      });

      return {
        id: inserted.id,
        eventId: inserted.eventId,
        userId: inserted.userId,
        method: inserted.method,
        createdAt: inserted.createdAt.toISOString(),
      } satisfies CheckIn;
    },

    async startDigitalCode(publisherSessionToken, eventId) {
      const event = await loadPublished(eventId);
      try {
        await auth.requirePublisherMember(
          publisherSessionToken,
          requirePublisherId(event.publisherId),
        );
      } catch (err) {
        if (err instanceof AuthError) {
          throw new CheckInError(err.code === 'forbidden' ? 'forbidden' : 'unauthorized');
        }
        throw err;
      }
      const codeRow = await ensureCodeRow(eventId);
      const at = now();
      if (!codeRow.revealedAt) {
        await db
          .update(schema.digitalCodes)
          .set({ revealedAt: at })
          .where(eq(schema.digitalCodes.eventId, eventId));
        return sessionFromRow(eventId, { ...codeRow, revealedAt: at }, at);
      }
      return sessionFromRow(eventId, codeRow, at);
    },

    async getDigitalCodeSession(publisherSessionToken, eventId) {
      const event = await loadPublished(eventId);
      try {
        await auth.requirePublisherMember(
          publisherSessionToken,
          requirePublisherId(event.publisherId),
        );
      } catch (err) {
        if (err instanceof AuthError) {
          throw new CheckInError(err.code === 'forbidden' ? 'forbidden' : 'unauthorized');
        }
        throw err;
      }
      const codeRow = await ensureCodeRow(eventId);
      return sessionFromRow(eventId, codeRow, now());
    },
  };
}
