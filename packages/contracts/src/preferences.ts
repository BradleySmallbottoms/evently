import { z } from 'zod';

// Local mirrors to avoid circular import with ./index (which re-exports this module).
const Id = z.uuid();
const GeoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const UserAreaKind = z.enum(['manual', 'region']);
export type UserAreaKind = z.infer<typeof UserAreaKind>;

export const UserAreaOrigin = z.enum(['manual', 'suggested']);
export type UserAreaOrigin = z.infer<typeof UserAreaOrigin>;

export const UserArea = z.object({
  id: Id,
  name: z.string(),
  kind: UserAreaKind,
  origin: UserAreaOrigin,
  regionId: Id.nullable(),
  /** Circle center when radiusM is set. */
  center: GeoPointSchema.nullable(),
  radiusM: z.number().int().nullable(),
  /** Drawn polygon ring (closed) when stored as an area polygon. */
  polygon: z.array(GeoPointSchema).nullable(),
  notify: z.boolean(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type UserArea = z.infer<typeof UserArea>;

export const UserPreferencesResponse = z.object({
  categoryIds: z.array(Id),
  areas: z.array(UserArea),
  quietHours: z.object({
    enabled: z.boolean(),
    startMin: z.number().int().min(0).max(1439),
    endMin: z.number().int().min(0).max(1439),
    timezone: z.string(),
  }),
});
export type UserPreferencesResponse = z.infer<typeof UserPreferencesResponse>;

export const ReplaceUserInterestsRequest = z.object({
  categoryIds: z.array(Id).max(50),
});
export type ReplaceUserInterestsRequest = z.infer<typeof ReplaceUserInterestsRequest>;

export const ReplaceUserInterestsResponse = z.object({
  categoryIds: z.array(Id),
});
export type ReplaceUserInterestsResponse = z.infer<typeof ReplaceUserInterestsResponse>;

export const CreateUserAreaRequest = z
  .object({
    name: z.string().trim().min(1).max(80),
    notify: z.boolean().optional(),
    active: z.boolean().optional(),
    origin: UserAreaOrigin.optional(),
    center: GeoPointSchema.optional(),
    radiusM: z.number().int().min(500).max(100_000).optional(),
    /** Outer ring only; at least 3 unique vertices (server closes the ring). */
    polygon: z.array(GeoPointSchema).min(3).max(100).optional(),
    /** Subscribe using a seeded region boundary (copies into area). */
    regionId: Id.optional(),
  })
  .superRefine((val, ctx) => {
    const hasCircle = val.center != null && val.radiusM != null;
    const hasPolygon = val.polygon != null;
    const hasRegion = val.regionId != null;
    const modes = [hasCircle, hasPolygon, hasRegion].filter(Boolean).length;
    if (modes !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide exactly one of center+radiusM, polygon, or regionId',
      });
    }
  });
export type CreateUserAreaRequest = z.infer<typeof CreateUserAreaRequest>;

export const UpdateUserAreaRequest = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  notify: z.boolean().optional(),
  active: z.boolean().optional(),
  center: GeoPointSchema.optional(),
  radiusM: z.number().int().min(500).max(100_000).optional(),
  polygon: z.array(GeoPointSchema).min(3).max(100).optional(),
});
export type UpdateUserAreaRequest = z.infer<typeof UpdateUserAreaRequest>;

export const UserAreaListResponse = z.object({
  items: z.array(UserArea),
});
export type UserAreaListResponse = z.infer<typeof UserAreaListResponse>;
