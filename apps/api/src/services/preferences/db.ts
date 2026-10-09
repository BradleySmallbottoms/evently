import type {
  CreateUserAreaRequest,
  UpdateUserAreaRequest,
  UpdateUserProfileRequest,
  UserArea,
  UserProfile,
} from '@local-events/contracts';
import type { Db } from '@local-events/db';
import { pointEwkt, polygonEwkt, schema } from '@local-events/db';
import {
  canAddSavedArea,
  normalizeRecoveryEmail,
  resolveProfileChoice,
  validateCircleArea,
  validatePolygonArea,
} from '@local-events/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AuthServices } from '../auth/types';
import { PreferenceError, type PreferenceEnv, type PreferenceServices } from './types';

function toProfile(row: {
  displayName: string | null;
  isPublic: boolean;
  profileChosenAt: Date | null;
  recoveryEmail: string | null;
  recoveryEmailVerifiedAt: Date | null;
}): UserProfile {
  return {
    displayName: row.displayName,
    isPublic: row.isPublic,
    profileChosen: row.profileChosenAt != null,
    recoveryEmail: row.recoveryEmail,
    recoveryEmailVerified: row.recoveryEmailVerifiedAt != null,
  };
}

type AreaRow = {
  id: string;
  name: string;
  kind: 'manual' | 'region';
  origin: 'manual' | 'suggested';
  regionId: string | null;
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
    regionId: row.regionId,
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
  regionId: schema.userAreas.regionId,
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
  const { userInterests, userAreas, categories, regions, users } = schema;

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
      const [user] = await db
        .select({
          timezone: users.timezone,
          quietHoursStartMin: users.quietHoursStartMin,
          quietHoursEndMin: users.quietHoursEndMin,
          quietHoursEnabled: users.quietHoursEnabled,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) throw new PreferenceError('unauthorized');
      const interestRows = await db
        .select({ categoryId: userInterests.categoryId })
        .from(userInterests)
        .where(eq(userInterests.userId, userId));
      return {
        categoryIds: interestRows.map((r) => r.categoryId),
        areas: await areasForUser(userId),
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
      const [user] = await db
        .update(users)
        .set({
          quietHoursEnabled: input.enabled,
          quietHoursStartMin: input.startMin,
          quietHoursEndMin: input.endMin,
        })
        .where(eq(users.id, userId))
        .returning({
          timezone: users.timezone,
          quietHoursStartMin: users.quietHoursStartMin,
          quietHoursEndMin: users.quietHoursEndMin,
          quietHoursEnabled: users.quietHoursEnabled,
        });
      if (!user) throw new PreferenceError('unauthorized');
      return {
        enabled: user.quietHoursEnabled,
        startMin: user.quietHoursStartMin,
        endMin: user.quietHoursEndMin,
        timezone: user.timezone,
      };
    },

    async getProfile(sessionToken) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const [row] = await db
        .select({
          displayName: users.displayName,
          isPublic: users.isPublic,
          profileChosenAt: users.profileChosenAt,
          recoveryEmail: users.recoveryEmail,
          recoveryEmailVerifiedAt: users.recoveryEmailVerifiedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!row) throw new PreferenceError('unauthorized');
      return toProfile(row);
    },

    async updateProfile(sessionToken, input: UpdateUserProfileRequest) {
      const { userId } = await auth.requireUserSession(sessionToken);
      const resolved =
        input.choice === 'anonymous'
          ? resolveProfileChoice({ choice: 'anonymous' })
          : resolveProfileChoice({
              choice: 'named',
              displayName: input.displayName ?? '',
              isPublic: input.isPublic,
            });
      if (!resolved.ok) throw new PreferenceError(resolved.reason);

      const [existing] = await db
        .select({
          recoveryEmail: users.recoveryEmail,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!existing) throw new PreferenceError('unauthorized');

      let recoveryEmail = existing.recoveryEmail;
      let clearVerified = false;
      if (input.recoveryEmail !== undefined) {
        const next = normalizeRecoveryEmail(input.recoveryEmail);
        if (next !== existing.recoveryEmail) {
          recoveryEmail = next;
          clearVerified = true;
        }
      }

      const [row] = await db
        .update(users)
        .set({
          displayName: resolved.displayName,
          isPublic: resolved.isPublic,
          profileChosenAt: _env.now(),
          recoveryEmail,
          ...(clearVerified ? { recoveryEmailVerifiedAt: null } : {}),
        })
        .where(eq(users.id, userId))
        .returning({
          displayName: users.displayName,
          isPublic: users.isPublic,
          profileChosenAt: users.profileChosenAt,
          recoveryEmail: users.recoveryEmail,
          recoveryEmailVerifiedAt: users.recoveryEmailVerifiedAt,
        });
      if (!row) throw new PreferenceError('unauthorized');
      return toProfile(row);
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
      let regionId: string | null = null;
      let kind: 'manual' | 'region' = 'manual';
      let origin: 'manual' | 'suggested' = input.origin ?? 'manual';

      if (input.regionId) {
        const [region] = await db
          .select({ id: regions.id, name: regions.name })
          .from(regions)
          .where(eq(regions.id, input.regionId))
          .limit(1);
        if (!region) throw new PreferenceError('unknown_region');
        regionId = region.id;
        kind = 'region';
        origin = input.origin ?? 'suggested';
      } else if (input.center && input.radiusM != null) {
        const check = validateCircleArea({ center: input.center, radiusM: input.radiusM });
        if (!check.ok) throw new PreferenceError('invalid_area');
        centerEwkt = pointEwkt(input.center);
        radiusM = input.radiusM;
        if (origin === 'suggested') kind = 'region';
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

        if (regionId) {
          await tx.execute(sql`
            INSERT INTO user_areas (
              id, user_id, name, kind, origin, region_id, area, center, radius_m, notify, active
            )
            SELECT
              ${id}::uuid,
              ${userId}::uuid,
              ${input.name},
              'region',
              ${origin},
              r.id,
              ST_SetSRID(ST_GeometryN(r.boundary::geometry, 1), 4326)::geography,
              NULL,
              NULL,
              ${input.notify ?? true},
              ${input.active ?? true}
            FROM regions r
            WHERE r.id = ${regionId}::uuid
          `);
        } else {
          await tx.insert(userAreas).values({
            id,
            userId,
            name: input.name,
            kind,
            origin,
            regionId: null,
            center: centerEwkt,
            radiusM,
            area: areaEwkt,
            notify: input.notify ?? true,
            active: input.active ?? true,
          });
        }
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
