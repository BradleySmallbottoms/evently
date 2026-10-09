import type {
  CreateUserAreaRequest,
  UpdateUserAreaRequest,
  UserArea,
} from '@local-events/contracts';
import {
  canAddSavedArea,
  validateCircleArea,
  validatePolygonArea,
} from '@local-events/domain';
import { randomUUID } from 'node:crypto';
import type { AuthServices } from '../auth/types';
import { createMemoryStore, type MemoryStore } from '../memory-store';
import { PreferenceError, type PreferenceEnv, type PreferenceServices } from './types';

function toUserArea(row: {
  id: string;
  name: string;
  kind: 'manual' | 'region';
  origin: 'manual' | 'suggested';
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
  const { userInterests, userAreas, categories } = store;

  return {
    async getPreferences(sessionToken) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const categoryIds = userInterests
        .filter((i) => i.userId === userId)
        .map((i) => i.categoryId);
      const areas = [...userAreas.values()]
        .filter((a) => a.userId === userId)
        .map(toUserArea);
      return { categoryIds, areas };
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

      if (input.center && input.radiusM != null) {
        const check = validateCircleArea({ center: input.center, radiusM: input.radiusM });
        if (!check.ok) throw new PreferenceError('invalid_area');
        center = input.center;
        radiusM = input.radiusM;
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
        kind: 'manual' as const,
        origin: 'manual' as const,
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
