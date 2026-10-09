import type {
  CreateUserAreaRequest,
  UpdateUserAreaRequest,
  UserArea,
} from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { pointEwkt, polygonEwkt, schema } from '@local-events/db';
import {
  canAddSavedArea,
  validateCircleArea,
  validatePolygonArea,
} from '@local-events/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AuthServices } from '../auth/types';
import { PreferenceError, type PreferenceEnv, type PreferenceServices } from './types';

type AreaRow = {
  id: string;
  name: string;
  kind: 'manual' | 'region';
  origin: 'manual' | 'suggested';
  lat: number | null;
  lng: number | null;
  radiusM: number | null;
  polygonGeoJson: string | null;
  notify: boolean;
  active: boolean;
  createdAt: Date;
};

function parsePolygon(geoJson: string | null): { lat: number; lng: number }[] | null {
  if (!geoJson) return null;
  try {
    const parsed = JSON.parse(geoJson) as {
      type?: string;
      coordinates?: number[][][];
    };
    const ring = parsed.coordinates?.[0];
    if (!ring) return null;
    return ring.map(([lng, lat]) => ({ lat: lat!, lng: lng! }));
  } catch {
    return null;
  }
}

function mapArea(row: AreaRow): UserArea {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    origin: row.origin,
    center: row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null,
    radiusM: row.radiusM,
    polygon: parsePolygon(row.polygonGeoJson),
    notify: row.notify,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

const areaSelect = {
  id: schema.userAreas.id,
  name: schema.userAreas.name,
  kind: schema.userAreas.kind,
  origin: schema.userAreas.origin,
  lat: sql<number | null>`ST_Y(${schema.userAreas.center}::geometry)`,
  lng: sql<number | null>`ST_X(${schema.userAreas.center}::geometry)`,
  radiusM: schema.userAreas.radiusM,
  polygonGeoJson: sql<string | null>`ST_AsGeoJSON(${schema.userAreas.area}::geometry)`,
  notify: schema.userAreas.notify,
  active: schema.userAreas.active,
  createdAt: schema.userAreas.createdAt,
};

export function createDbPreferenceServices(
  db: Db,
  auth: AuthServices,
  _env: PreferenceEnv = { now: () => new Date() },
): PreferenceServices {
  const { userInterests, userAreas, categories } = schema;

  async function areasForUser(userId: string): Promise<UserArea[]> {
    const rows = await db
      .select(areaSelect)
      .from(userAreas)
      .where(eq(userAreas.userId, userId));
    return rows.map(mapArea);
  }

  return {
    async getPreferences(sessionToken) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const interestRows = await db
        .select({ categoryId: userInterests.categoryId })
        .from(userInterests)
        .where(eq(userInterests.userId, userId));
      return {
        categoryIds: interestRows.map((r) => r.categoryId),
        areas: await areasForUser(userId),
      };
    },

    async replaceInterests(sessionToken, input) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const unique = [...new Set(input.categoryIds)];
      if (unique.length > 0) {
        const found = await db
          .select({ id: categories.id })
          .from(categories)
          .where(inArray(categories.id, unique));
        if (found.length !== unique.length) throw new PreferenceError('unknown_category');
      }

      await db.transaction(async (tx) => {
        await tx.delete(userInterests).where(eq(userInterests.userId, userId));
        if (unique.length > 0) {
          await tx.insert(userInterests).values(
            unique.map((categoryId) => ({ userId, categoryId })),
          );
        }
      });
      return { categoryIds: unique };
    },

    async listAreas(sessionToken) {
      const { userId } = await auth.requireUserSession(sessionToken);
      return { items: await areasForUser(userId) };
    },

    async createArea(sessionToken, input: CreateUserAreaRequest) {
      const { userId } = await auth.requireUserSession(sessionToken);

      let centerEwkt: string | null = null;
      let radiusM: number | null = null;
      let areaEwkt: string | null = null;

      if (input.center && input.radiusM != null) {
        const check = validateCircleArea({ center: input.center, radiusM: input.radiusM });
        if (!check.ok) throw new PreferenceError('invalid_area');
        centerEwkt = pointEwkt(input.center);
        radiusM = input.radiusM;
      } else if (input.polygon) {
        const check = validatePolygonArea({ polygon: input.polygon });
        if (!check.ok) throw new PreferenceError('invalid_area');
        areaEwkt = polygonEwkt(input.polygon);
      } else {
        throw new PreferenceError('invalid_area');
      }

      const id = randomUUID();
      await db.transaction(async (tx) => {
        const [countRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(userAreas)
          .where(eq(userAreas.userId, userId));
        if (!canAddSavedArea(countRow?.count ?? 0)) throw new PreferenceError('area_limit');

        await tx.insert(userAreas).values({
          id,
          userId,
          name: input.name,
          kind: 'manual',
          origin: 'manual',
          center: centerEwkt,
          radiusM,
          area: areaEwkt,
          notify: input.notify ?? true,
          active: input.active ?? true,
        });
      });

      const [row] = await db
        .select(areaSelect)
        .from(userAreas)
        .where(eq(userAreas.id, id))
        .limit(1);
      if (!row) throw new PreferenceError('not_found');
      return mapArea(row);
    },

    async updateArea(sessionToken, areaId, input: UpdateUserAreaRequest) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const [existing] = await db
        .select({ id: userAreas.id })
        .from(userAreas)
        .where(and(eq(userAreas.id, areaId), eq(userAreas.userId, userId)))
        .limit(1);
      if (!existing) throw new PreferenceError('not_found');

      const patch: {
        name?: string;
        notify?: boolean;
        active?: boolean;
        center?: string | null;
        radiusM?: number | null;
        area?: string | null;
      } = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.notify !== undefined) patch.notify = input.notify;
      if (input.active !== undefined) patch.active = input.active;

      if (input.center && input.radiusM != null) {
        const check = validateCircleArea({ center: input.center, radiusM: input.radiusM });
        if (!check.ok) throw new PreferenceError('invalid_area');
        patch.center = pointEwkt(input.center);
        patch.radiusM = input.radiusM;
        patch.area = null;
      } else if (input.polygon) {
        const check = validatePolygonArea({ polygon: input.polygon });
        if (!check.ok) throw new PreferenceError('invalid_area');
        patch.area = polygonEwkt(input.polygon);
        patch.center = null;
        patch.radiusM = null;
      } else if (input.center || input.radiusM != null) {
        throw new PreferenceError('invalid_area');
      }

      if (Object.keys(patch).length > 0) {
        await db
          .update(userAreas)
          .set(patch)
          .where(and(eq(userAreas.id, areaId), eq(userAreas.userId, userId)));
      }

      const [row] = await db
        .select(areaSelect)
        .from(userAreas)
        .where(eq(userAreas.id, areaId))
        .limit(1);
      if (!row) throw new PreferenceError('not_found');
      return mapArea(row);
    },

    async deleteArea(sessionToken, areaId) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const deleted = await db
        .delete(userAreas)
        .where(and(eq(userAreas.id, areaId), eq(userAreas.userId, userId)))
        .returning({ id: userAreas.id });
      if (deleted.length === 0) throw new PreferenceError('not_found');
    },
  };
}
