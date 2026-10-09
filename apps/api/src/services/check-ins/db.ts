import type { CheckIn, CreateGeoCheckInRequest } from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { schema } from '@local-events/db';
import { checkInWindow, validateGeoCheckIn } from '@local-events/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { createMemoryDomainEventPublisher } from '../domain-events/memory';
import { enqueueDomainEvent } from '../domain-events/types';
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

  async function loadPublishedPhysical(eventId: string) {
    const [row] = await db
      .select({
        id: schema.events.id,
        mode: schema.events.mode,
        status: schema.events.status,
        startsAt: schema.events.startsAt,
        endsAt: schema.events.endsAt,
        geofenceRadiusM: schema.events.geofenceRadiusM,
        lat: sql<number>`ST_Y(${schema.events.location}::geometry)`,
        lng: sql<number>`ST_X(${schema.events.location}::geometry)`,
        hasLocation: sql<boolean>`${schema.events.location} IS NOT NULL`,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!row || row.status !== 'published') throw new CheckInError('not_found');
    if (row.mode !== 'physical' || !row.hasLocation) throw new CheckInError('not_physical');
    return row;
  }

  return {
    async getStatus(sessionToken, eventId) {
      const { userId } = await requireUser(sessionToken);
      const row = await loadPublishedPhysical(eventId);
      const window = checkInWindow({ startsAt: row.startsAt, endsAt: row.endsAt });
      const at = now();
      const [existing] = await db
        .select({ id: schema.checkIns.id })
        .from(schema.checkIns)
        .where(
          and(eq(schema.checkIns.userId, userId), eq(schema.checkIns.eventId, eventId)),
        )
        .limit(1);
      return {
        checkedIn: Boolean(existing),
        open: at >= window.opensAt && at <= window.closesAt,
        opensAt: window.opensAt.toISOString(),
        closesAt: window.closesAt.toISOString(),
      };
    },

    async createGeo(sessionToken, eventId, input: CreateGeoCheckInRequest) {
      const { userId } = await requireUser(sessionToken);
      const row = await loadPublishedPhysical(eventId);
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

      const out: CheckIn = {
        id: inserted.id,
        eventId: inserted.eventId,
        userId: inserted.userId,
        method: inserted.method,
        createdAt: inserted.createdAt.toISOString(),
      };
      return out;
    },
  };
}
