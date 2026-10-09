import { z } from 'zod';

const Id = z.uuid();
const GeoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const CheckInMethod = z.enum(['geo', 'code']);
export type CheckInMethod = z.infer<typeof CheckInMethod>;

export const CreateGeoCheckInRequest = z.object({
  location: GeoPointSchema,
  accuracyM: z.number().nonnegative().max(10_000),
});
export type CreateGeoCheckInRequest = z.infer<typeof CreateGeoCheckInRequest>;

export const CheckIn = z.object({
  id: Id,
  eventId: Id,
  userId: Id,
  method: CheckInMethod,
  createdAt: z.iso.datetime(),
});
export type CheckIn = z.infer<typeof CheckIn>;

export const CheckInStatusResponse = z.object({
  checkedIn: z.boolean(),
  /** Server clock — clients use this with event times for window UI. */
  open: z.boolean(),
  opensAt: z.iso.datetime(),
  closesAt: z.iso.datetime(),
});
export type CheckInStatusResponse = z.infer<typeof CheckInStatusResponse>;
