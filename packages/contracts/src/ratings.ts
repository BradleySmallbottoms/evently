import { z } from 'zod';

const Id = z.uuid();

export const CreateRatingRequest = z.object({
  score: z.number().int().min(1).max(5),
  /** Only accepted for named public profiles; stripped otherwise. */
  comment: z.string().trim().max(2000).nullable().optional(),
});
export type CreateRatingRequest = z.infer<typeof CreateRatingRequest>;

export const Rating = z.object({
  id: Id,
  eventId: Id,
  userId: Id,
  score: z.number().int().min(1).max(5),
  /** Always null on public/attendee responses; publisher manage includes text. */
  comment: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Rating = z.infer<typeof Rating>;

export const RatingAggregate = z.object({
  average: z.number().nullable(),
  count: z.number().int().nonnegative(),
});
export type RatingAggregate = z.infer<typeof RatingAggregate>;

export const RatingStatusResponse = z.object({
  canRate: z.boolean(),
  hasRated: z.boolean(),
  opensAt: z.iso.datetime(),
  closesAt: z.iso.datetime(),
  myScore: z.number().int().min(1).max(5).nullable(),
  aggregate: RatingAggregate,
});
export type RatingStatusResponse = z.infer<typeof RatingStatusResponse>;

export const PublisherRating = z.object({
  id: Id,
  eventId: Id,
  userId: Id,
  score: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  displayName: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type PublisherRating = z.infer<typeof PublisherRating>;

export const PublisherRatingListResponse = z.object({
  items: z.array(PublisherRating),
  aggregate: RatingAggregate,
});
export type PublisherRatingListResponse = z.infer<typeof PublisherRatingListResponse>;
