import { z } from 'zod';

// Local mirrors to avoid circular import with ./index (which re-exports this module).
const Id = z.uuid();
const GeoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
const EventMode = z.enum(['physical', 'digital']);
const EventStatus = z.enum([
  'draft',
  'awaiting_verification',
  'in_review',
  'published',
  'cancelled',
  'ended',
]);
const EventOrigin = z.enum(['native', 'imported']);

export const Category = z.object({
  id: Id,
  slug: z.string(),
  parentId: Id.nullable(),
  nameSv: z.string(),
  nameEn: z.string(),
});
export type Category = z.infer<typeof Category>;

export const CategoryListResponse = z.object({
  items: z.array(Category),
});
export type CategoryListResponse = z.infer<typeof CategoryListResponse>;

export const Event = z.object({
  id: Id,
  publisherId: Id,
  title: z.string(),
  description: z.string().nullable(),
  mode: EventMode,
  status: EventStatus,
  origin: EventOrigin,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timezone: z.string(),
  venueName: z.string().nullable(),
  location: GeoPointSchema.nullable(),
  geofenceRadiusM: z.number().int().nullable(),
  onlineUrl: z.url().nullable(),
  categoryIds: z.array(Id),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Event = z.infer<typeof Event>;

export const CreateEventRequest = z
  .object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(10_000).optional(),
    mode: EventMode,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    timezone: z.string().min(1).max(64).optional().default('Europe/Stockholm'),
    venueName: z.string().trim().max(200).optional(),
    location: GeoPointSchema.optional(),
    geofenceRadiusM: z.number().int().min(10).max(5000).optional(),
    onlineUrl: z.url().optional(),
    categoryIds: z.array(Id).max(20).default([]),
  })
  .refine((b) => new Date(b.endsAt) > new Date(b.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });
export type CreateEventRequest = z.infer<typeof CreateEventRequest>;

export const UpdateEventRequest = z
  .object({
    title: z.string().trim().min(2).max(200).optional(),
    description: z.string().trim().max(10_000).nullable().optional(),
    mode: EventMode.optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    timezone: z.string().min(1).max(64).optional(),
    venueName: z.string().trim().max(200).nullable().optional(),
    location: GeoPointSchema.nullable().optional(),
    geofenceRadiusM: z.number().int().min(10).max(5000).nullable().optional(),
    onlineUrl: z.url().nullable().optional(),
    categoryIds: z.array(Id).max(20).optional(),
  })
  .refine(
    (b) => {
      if (b.startsAt && b.endsAt) return new Date(b.endsAt) > new Date(b.startsAt);
      return true;
    },
    { message: 'endsAt must be after startsAt', path: ['endsAt'] },
  );
export type UpdateEventRequest = z.infer<typeof UpdateEventRequest>;

export const EventResponse = Event;
export type EventResponse = Event;

export const EventListResponse = z.object({
  items: z.array(Event),
});
export type EventListResponse = z.infer<typeof EventListResponse>;

export const PublicEventListQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusM: z.coerce.number().int().min(100).max(200_000).optional().default(50_000),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});
export type PublicEventListQuery = z.infer<typeof PublicEventListQuery>;

export const PublisherSummaryAdmin = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  type: z.enum(['org', 'person']),
  verified: z.boolean(),
  origin: EventOrigin,
  createdAt: z.iso.datetime(),
});
export type PublisherSummaryAdmin = z.infer<typeof PublisherSummaryAdmin>;

export const AdminPublisherListResponse = z.object({
  items: z.array(PublisherSummaryAdmin),
});
export type AdminPublisherListResponse = z.infer<typeof AdminPublisherListResponse>;

export const VerifyPublisherResponse = z.object({
  id: Id,
  verified: z.literal(true),
  releasedEventCount: z.number().int().nonnegative(),
});
export type VerifyPublisherResponse = z.infer<typeof VerifyPublisherResponse>;
