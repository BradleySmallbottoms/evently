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

export const CreateCodeCheckInRequest = z.object({
  /** 6-character rotating code from venue QR or publisher screen. */
  code: z.string().trim().min(4).max(16),
});
export type CreateCodeCheckInRequest = z.infer<typeof CreateCodeCheckInRequest>;

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
  /** Publisher has started the live code session (venue QR / digital). */
  codeActive: z.boolean(),
});
export type CheckInStatusResponse = z.infer<typeof CheckInStatusResponse>;

/** Publisher live code session (current slot only — secret never returned). */
export const DigitalCodeSessionResponse = z.object({
  eventId: Id,
  revealed: z.boolean(),
  /** Present when revealed; rotates every ~60s. */
  code: z.string().nullable(),
  /** Deep link / QR payload for the current code. */
  qrPayload: z.string().nullable(),
  slotEndsAt: z.iso.datetime().nullable(),
  rotationS: z.number().int(),
});
export type DigitalCodeSessionResponse = z.infer<typeof DigitalCodeSessionResponse>;
