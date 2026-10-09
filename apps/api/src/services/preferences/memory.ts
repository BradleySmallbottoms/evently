import type {
  CreateUserAreaRequest,
  UpdateUserAreaRequest,
  UpdateUserProfileRequest,
  UserArea,
  UserProfile,
} from '@local-events/contracts';
import {
  canAddSavedArea,
  normalizeRecoveryEmail,
  resolveProfileChoice,
  validateCircleArea,
  validatePolygonArea,
} from '@local-events/domain';
import { randomUUID } from 'node:crypto';
import type { AuthServices } from '../auth/types';
import { createMemoryStore, type MemoryStore } from '../memory-store';
import { PreferenceError, type PreferenceEnv, type PreferenceServices } from './types';

function toProfile(user: {
  displayName: string | null;
  isPublic: boolean;
  profileChosenAt: Date | null;
  recoveryEmail: string | null;
  recoveryEmailVerifiedAt: Date | null;
}): UserProfile {
  return {
    displayName: user.displayName,
    isPublic: user.isPublic,
    profileChosen: user.profileChosenAt != null,
    recoveryEmail: user.recoveryEmail,
    recoveryEmailVerified: user.recoveryEmailVerifiedAt != null,
  };
}

function toUserArea(row: {
  id: string;
  name: string;
  kind: 'manual' | 'region';
  origin: 'manual' | 'suggested';
  regionId: string | null;
  center: { lat: number; lng: number } | null;
  radiusM: number | null;
  polygon: { lat: number; lng: number }[] | null;
  notify: boolean;
  active: boolean;
  createdAt: Date;
}): UserArea {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    origin: row.origin,
    regionId: row.regionId,
    center: row.center,
    radiusM: row.radiusM,
    polygon: row.polygon,
    notify: row.notify,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createMemoryPreferenceServices(
  auth: AuthServices,
  env: PreferenceEnv = { now: () => new Date() },
  store: MemoryStore = createMemoryStore(),
): PreferenceServices {
  const { userInterests, userAreas, categories, regions } = store;

  return {
    async getPreferences(sessionToken) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const user = store.users.get(userId);
      if (!user) throw new PreferenceError('unauthorized');
      const categoryIds = userInterests
        .filter((i) => i.userId === userId)
        .map((i) => i.categoryId);
      const areas = [...userAreas.values()]
        .filter((a) => a.userId === userId)
        .map(toUserArea);
      return {
        categoryIds,
        areas,
        quietHours: {
          enabled: user.quietHoursEnabled,
          startMin: user.quietHoursStartMin,
          endMin: user.quietHoursEndMin,
          timezone: user.timezone,
        },
      };
    },

    async updateQuietHours(sessionToken, input) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const user = store.users.get(userId);
      if (!user) throw new PreferenceError('unauthorized');
      user.quietHoursEnabled = input.enabled;
      user.quietHoursStartMin = input.startMin;
      user.quietHoursEndMin = input.endMin;
      return {
        enabled: user.quietHoursEnabled,
        startMin: user.quietHoursStartMin,
        endMin: user.quietHoursEndMin,
        timezone: user.timezone,
      };
    },

    async getProfile(sessionToken) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const user = store.users.get(userId);
      if (!user) throw new PreferenceError('unauthorized');
      return toProfile(user);
    },

    async updateProfile(sessionToken, input: UpdateUserProfileRequest) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const user = store.users.get(userId);
      if (!user) throw new PreferenceError('unauthorized');
      const resolved =
        input.choice === 'anonymous'
          ? resolveProfileChoice({ choice: 'anonymous' })
          : resolveProfileChoice({
              choice: 'named',
              displayName: input.displayName ?? '',
              isPublic: input.isPublic,
            });
      if (!resolved.ok) throw new PreferenceError(resolved.reason);
      user.displayName = resolved.displayName;
      user.isPublic = resolved.isPublic;
      user.profileChosenAt = env.now();
      if (input.recoveryEmail !== undefined) {
        const next = normalizeRecoveryEmail(input.recoveryEmail);
        if (next !== user.recoveryEmail) {
          user.recoveryEmail = next;
          user.recoveryEmailVerifiedAt = null;
        }
      }
      return toProfile(user);
    },

    async replaceInterests(sessionToken, input) {
      const { userId } = await auth.requireUserSession(sessionToken);
      for (const id of input.categoryIds) {
        if (!categories.has(id)) throw new PreferenceError('unknown_category');
      }
      const kept = userInterests.filter((i) => i.userId !== userId);
      userInterests.length = 0;
      userInterests.push(...kept);
      const now = env.now();
      const unique = [...new Set(input.categoryIds)];
      for (const categoryId of unique) {
        userInterests.push({ userId, categoryId, createdAt: now });
      }
      return { categoryIds: unique };
    },

    async listAreas(sessionToken) {
      const { userId } = await auth.requireUserSession(sessionToken);
      return {
        items: [...userAreas.values()].filter((a) => a.userId === userId).map(toUserArea),
      };
    },

    async createArea(sessionToken, input: CreateUserAreaRequest) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const count = [...userAreas.values()].filter((a) => a.userId === userId).length;
      if (!canAddSavedArea(count)) throw new PreferenceError('area_limit');

      let center: { lat: number; lng: number } | null = null;
      let radiusM: number | null = null;
      let polygon: { lat: number; lng: number }[] | null = null;
      let regionId: string | null = null;
      let kind: 'manual' | 'region' = 'manual';
      let origin: 'manual' | 'suggested' = input.origin ?? 'manual';

      if (input.regionId) {
        const region = regions.get(input.regionId);
        if (!region) throw new PreferenceError('unknown_region');
        regionId = region.id;
        kind = 'region';
        origin = input.origin ?? 'suggested';
        polygon = [
          { lat: region.bbox.minLat, lng: region.bbox.minLng },
          { lat: region.bbox.minLat, lng: region.bbox.maxLng },
          { lat: region.bbox.maxLat, lng: region.bbox.maxLng },
          { lat: region.bbox.maxLat, lng: region.bbox.minLng },
        ];
      } else if (input.center && input.radiusM != null) {
        const check = validateCircleArea({ center: input.center, radiusM: input.radiusM });
        if (!check.ok) throw new PreferenceError('invalid_area');
        center = input.center;
        radiusM = input.radiusM;
        if (origin === 'suggested') kind = 'region';
      } else if (input.polygon) {
        const check = validatePolygonArea({ polygon: input.polygon });
        if (!check.ok) throw new PreferenceError('invalid_area');
        polygon = input.polygon;
      } else {
        throw new PreferenceError('invalid_area');
      }

      const id = randomUUID();
      const row = {
        id,
        userId,
        name: input.name,
        kind,
        origin,
        regionId,
        center,
        radiusM,
        polygon,
        notify: input.notify ?? true,
        active: input.active ?? true,
        createdAt: env.now(),
      };
      userAreas.set(id, row);
      return toUserArea(row);
    },

    async updateArea(sessionToken, areaId, input: UpdateUserAreaRequest) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const row = userAreas.get(areaId);
      if (!row || row.userId !== userId) throw new PreferenceError('not_found');

      if (input.name !== undefined) row.name = input.name;
      if (input.notify !== undefined) row.notify = input.notify;
      if (input.active !== undefined) row.active = input.active;

      if (input.center && input.radiusM != null) {
        const check = validateCircleArea({ center: input.center, radiusM: input.radiusM });
        if (!check.ok) throw new PreferenceError('invalid_area');
        row.center = input.center;
        row.radiusM = input.radiusM;
        row.polygon = null;
      } else if (input.polygon) {
        const check = validatePolygonArea({ polygon: input.polygon });
        if (!check.ok) throw new PreferenceError('invalid_area');
        row.polygon = input.polygon;
        row.center = null;
        row.radiusM = null;
      } else if (input.center || input.radiusM != null) {
        throw new PreferenceError('invalid_area');
      }

      return toUserArea(row);
    },

    async deleteArea(sessionToken, areaId) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const row = userAreas.get(areaId);
      if (!row || row.userId !== userId) throw new PreferenceError('not_found');
      userAreas.delete(areaId);
    },
  };
}
