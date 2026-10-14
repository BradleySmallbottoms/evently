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
  resolveTravelDistanceM,
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
  searchRadiusM: number | null;
  polygon: { lat: number; lng: number }[] | null;
  notify: boolean;
  active: boolean;
  tagIds: string[];
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
    searchRadiusM: row.searchRadiusM,
    polygon: row.polygon,
    notify: row.notify,
    active: row.active,
    tagIds: row.tagIds,
    createdAt: row.createdAt.toISOString(),
  };
}

function uniqueTagIds(tagIds: readonly string[] | undefined, known: { has: (id: string) => boolean }): string[] {
  const unique = [...new Set(tagIds ?? [])];
  for (const id of unique) {
    if (!known.has(id)) throw new PreferenceError('unknown_tag');
  }
  return unique;
}

export function createMemoryPreferenceServices(
  auth: AuthServices,
  env: PreferenceEnv = { now: () => new Date() },
  store: MemoryStore = createMemoryStore(),
): PreferenceServices {
  const { userAreas, tags, regions } = store;

  return {
    async getPreferences(sessionToken) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const user = store.users.get(userId);
      if (!user) throw new PreferenceError('unauthorized');
      const areas = [...userAreas.values()]
        .filter((a) => a.userId === userId)
        .map(toUserArea);
      return {
        areas,
        quietHours: {
          enabled: user.quietHoursEnabled,
          startMin: user.quietHoursStartMin,
          endMin: user.quietHoursEndMin,
          timezone: user.timezone,
        },
        travelDistanceM: resolveTravelDistanceM(user.travelDistanceM),
        discoveryRadiusM: user.discoveryRadiusM,
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

    async updateTravelDistance(sessionToken, input) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const user = store.users.get(userId);
      if (!user) throw new PreferenceError('unauthorized');
      user.travelDistanceM = resolveTravelDistanceM(input.distanceM);
      return { distanceM: resolveTravelDistanceM(user.travelDistanceM) };
    },

    async updateDiscoveryRadius(sessionToken, input) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const user = store.users.get(userId);
      if (!user) throw new PreferenceError('unauthorized');
      user.discoveryRadiusM = resolveTravelDistanceM(input.radiusM);
      return { radiusM: user.discoveryRadiusM };
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

      const tagIds = uniqueTagIds(input.tagIds, tags);
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
        searchRadiusM: radiusM == null ? null : resolveTravelDistanceM(radiusM),
        polygon,
        notify: input.notify ?? true,
        active: input.active ?? true,
        tagIds,
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

      if (input.searchRadiusM != null) {
        row.searchRadiusM = resolveTravelDistanceM(input.searchRadiusM);
      }

      if (input.tagIds !== undefined) row.tagIds = uniqueTagIds(input.tagIds, tags);

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
