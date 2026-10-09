import type {
  CheckIn,
  CreateCodeCheckInRequest,
  CreateGeoCheckInRequest,
  DigitalCodeSessionResponse,
} from '@local-events/contracts';
import {
  checkInWindow,
  DIGITAL_CODE_SLOT_SECONDS,
  digitalCheckInQrPayload,
  digitalCodeSlot,
  validateCodeCheckIn,
  validateGeoCheckIn,
} from '@local-events/domain';
import { randomUUID } from 'node:crypto';
import type { AuthServices } from '../auth/types';
import { AuthError } from '../auth/types';
import { createMemoryDomainEventPublisher } from '../domain-events/memory';
import { enqueueDomainEvent } from '../domain-events/types';
import {
  createMemoryStore,
  type MemoryCheckIn,
  type MemoryStore,
} from '../memory-store';
import { deriveDigitalCode, generateDigitalCodeSecret, validCodesForNow } from './codes';
import { CheckInError, type CheckInEnv, type CheckInServices } from './types';

const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type { MemoryCheckIn };

export function createMemoryCheckInServices(
  auth: AuthServices,
  env: CheckInEnv = {},
  store: MemoryStore = createMemoryStore(),
): CheckInServices {
  const now = env.now ?? (() => new Date());
  const domainEvents = env.domainEvents ?? createMemoryDomainEventPublisher();
  const checkIns = store.checkIns;

  async function requireUser(sessionToken: string | undefined) {
    try {
      return await auth.requireUserSession(sessionToken);
    } catch (err) {
      if (err instanceof AuthError) throw new CheckInError('unauthorized');
      throw err;
    }
  }

  function loadPublished(eventId: string) {
    const row = store.events.get(eventId);
    if (!row || row.status !== 'published') throw new CheckInError('not_found');
    return row;
  }

  function ensureCodeRow(eventId: string) {
    let row = store.digitalCodes.get(eventId);
    if (!row) {
      row = {
        eventId,
        secret: generateDigitalCodeSecret(),
        revealedAt: null,
        rotationS: DIGITAL_CODE_SLOT_SECONDS,
        createdAt: now(),
      };
      store.digitalCodes.set(eventId, row);
    }
    return row;
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

  return {
    async getStatus(sessionToken, eventId) {
      const { userId } = await requireUser(sessionToken);
      const row = loadPublished(eventId);
      const window = checkInWindow({
        startsAt: row.startsAtDate,
        endsAt: row.endsAtDate,
      });
      const at = now();
      const codeRow = store.digitalCodes.get(eventId);
      return {
        checkedIn: checkIns.some((c) => c.userId === userId && c.eventId === eventId),
        open: at >= window.opensAt && at <= window.closesAt,
        opensAt: window.opensAt.toISOString(),
        closesAt: window.closesAt.toISOString(),
        codeActive: Boolean(codeRow?.revealedAt),
      };
    },

    async createGeo(sessionToken, eventId, input: CreateGeoCheckInRequest) {
      const { userId } = await requireUser(sessionToken);
      const row = loadPublished(eventId);
      if (row.mode !== 'physical' || !row.location) throw new CheckInError('not_physical');
      const already = checkIns.some((c) => c.userId === userId && c.eventId === eventId);
      const result = validateGeoCheckIn({
        event: {
          startsAt: row.startsAtDate,
          endsAt: row.endsAtDate,
          geofenceCenter: row.location,
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
      return {
        id: checkIn.id,
        eventId,
        userId,
        method: 'geo',
        createdAt: createdAt.toISOString(),
      } satisfies CheckIn;
    },

    async createCode(sessionToken, eventId, input: CreateCodeCheckInRequest) {
      const { userId } = await requireUser(sessionToken);
      const row = loadPublished(eventId);
      const already = checkIns.some((c) => c.userId === userId && c.eventId === eventId);
      const codeRow = store.digitalCodes.get(eventId);
      const at = now();
      const result = validateCodeCheckIn({
        event: { startsAt: row.startsAtDate, endsAt: row.endsAtDate },
        revealed: Boolean(codeRow?.revealedAt),
        validCodes: codeRow ? validCodesForNow(codeRow.secret, at) : [],
        code: input.code,
        alreadyCheckedIn: already,
        now: at,
      });
      if (!result.ok) throw new CheckInError(result.reason);

      const checkIn: MemoryCheckIn = {
        id: randomUUID(),
        userId,
        eventId,
        method: 'code',
        lat: null,
        lng: null,
        accuracyM: null,
        createdAt: at,
      };
      checkIns.push(checkIn);
      await enqueueDomainEvent(domainEvents, {
        type: 'checkin.created',
        eventId,
        userId,
      });
      return {
        id: checkIn.id,
        eventId,
        userId,
        method: 'code',
        createdAt: at.toISOString(),
      } satisfies CheckIn;
    },

    async startDigitalCode(publisherSessionToken, eventId) {
      const event = loadPublished(eventId);
      try {
        await auth.requirePublisherMember(publisherSessionToken, event.publisherId);
      } catch (err) {
        if (err instanceof AuthError) {
          throw new CheckInError(err.code === 'forbidden' ? 'forbidden' : 'unauthorized');
        }
        throw err;
      }
      const codeRow = ensureCodeRow(eventId);
      const at = now();
      if (!codeRow.revealedAt) codeRow.revealedAt = at;
      return sessionFromRow(eventId, codeRow, at);
    },

    async getDigitalCodeSession(publisherSessionToken, eventId) {
      const event = loadPublished(eventId);
      try {
        await auth.requirePublisherMember(publisherSessionToken, event.publisherId);
      } catch (err) {
        if (err instanceof AuthError) {
          throw new CheckInError(err.code === 'forbidden' ? 'forbidden' : 'unauthorized');
        }
        throw err;
      }
      return sessionFromRow(eventId, ensureCodeRow(eventId), now());
    },
  };
}
