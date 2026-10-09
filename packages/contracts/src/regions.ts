import { z } from 'zod';

const Id = z.uuid();

export const RegionKind = z.enum(['municipality', 'county']);
export type RegionKind = z.infer<typeof RegionKind>;

export const Region = z.object({
  id: Id,
  name: z.string(),
  kind: RegionKind,
  code: z.string(),
});
export type Region = z.infer<typeof Region>;

export const RegionLookupQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
export type RegionLookupQuery = z.infer<typeof RegionLookupQuery>;

export const RegionLookupResponse = z.object({
  /** Best match: municipality preferred over county when both cover the point. */
  region: Region.nullable(),
});
export type RegionLookupResponse = z.infer<typeof RegionLookupResponse>;
