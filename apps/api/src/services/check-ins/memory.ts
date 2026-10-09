import type { CheckIn, CreateGeoCheckInRequest } from '@local-events/contracts';
import { checkInWindow, validateGeoCheckIn } from '@local-events/domain';
import { randomUUID } from 'node:crypto';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { createMemoryDomainEventPublisher } from '../domain-events/memory';
import { enqueueDomainEvent } from '../domain-events/types';
import { createMemoryStore, type MemoryStore } from '../memory-store';
import { CheckInError, type CheckInEnv, type CheckInServices } from './types';

const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type MemoryCheckIn = {
  id: string;
  userId: string;
  eventId: string;
  method: 'geo' | 'code';
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  createdAt: Date;
};

export function createMemoryCheckInServices(
  auth: AuthServices,
  env: CheckInEnv = {},
  store: MemoryStore = createMemoryStore(),
  checkIns: MemoryCheckIn[] = [],
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

  function loadPublishedPhysical(eventId: string) {
    const row = store.events.get(eventId);
    if (!row || row.status !== 'published') throw new CheckInError('not_found');
    if (row.mode !== 'physical' || !row.location) throw new CheckInError('not_physical');
    return row;
  }

  return {
    async getStatus(sessionToken, eventId) {
      const { userId } = await requireUser(sessionToken);
      const row = loadPublishedPhysical(eventId);
      const window = checkInWindow({
        startsAt: row.startsAtDate,
        endsAt: row.endsAtDate,
      });
      const at = now();
      return {
        checkedIn: checkIns.some((c) => c.userId === userId && c.eventId === eventId),
        open: at >= window.opensAt && at <= window.closesAt,
        opensAt: window.opensAt.toISOString(),
        closesAt: window.closesAt.toISOString(),
      };
    },

    async createGeo(sessionToken, eventId, input: CreateGeoCheckInRequest) {
      const { userId } = await requireUser(sessionToken);
      const row = loadPublishedPhysical(eventId);
      const already = checkIns.some((c) => c.userId === userId && c.eventId === eventId);
      const result = validateGeoCheckIn({
        event: {
          startsAt: row.startsAtDate,
          endsAt: row.endsAtDate,
          geofenceCenter: row.location!,
          geofenceRadiusM: row.geofenceRadiusM ?? DEFAULT_GEOFENCE_RADIUS_M,
        },
        location: input.location,
        accuracyM: input.accuracyM,
        alreadyCheckedIn: already,
        now: now(),
      });
      if (!result.ok) throw new CheckInError(result.reason);

      if (checkIns.some((c) => c.userId === userId && c.eventId === eventId)) {
        throw new CheckInError('already_checked_in');
      }

      const createdAt = now();
      const checkIn: MemoryCheckIn = {
        id: randomUUID(),
        userId,
        eventId,
        method: 'geo',
        lat: input.location.lat,
        lng: input.location.lng,
        accuracyM: Math.round(input.accuracyM),
        createdAt,
      };
      checkIns.push(checkIn);
      await enqueueDomainEvent(domainEvents, {
        type: 'checkin.created',
        eventId,
        userId,
      });
      const out: CheckIn = {
        id: checkIn.id,
        eventId,
        userId,
        method: 'geo',
        createdAt: createdAt.toISOString(),
      };
      return out;
    },
  };
}
