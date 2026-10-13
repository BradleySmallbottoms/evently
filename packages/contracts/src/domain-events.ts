import { z } from 'zod';

const Id = z.uuid();

/** Domain events published to SQS for the worker. */
export const DomainEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('event.published'), eventId: Id }),
  z.object({
    type: z.literal('event.updated'),
    eventId: Id,
    changedFields: z.array(z.string()),
  }),
  z.object({ type: z.literal('checkin.created'), eventId: Id, userId: Id }),
  z.object({ type: z.literal('event.saved'), eventId: Id, userId: Id }),
  z.object({ type: z.literal('event.unsaved'), eventId: Id, userId: Id }),
  z.object({ type: z.literal('event.coming'), eventId: Id, userId: Id }),
  z.object({ type: z.literal('event.coming_cleared'), eventId: Id, userId: Id }),
  z.object({
    type: z.literal('rating.created'),
    eventId: Id,
    userId: Id,
    score: z.number().int().min(1).max(5),
  }),
]);
export type DomainEvent = z.infer<typeof DomainEvent>;
