import { z } from 'zod';

const Id = z.uuid();

/** A user's report of a public listing. The user id stays on the server. */
export const EventReport = z.object({
  id: Id,
  eventId: Id,
  createdAt: z.iso.datetime(),
});
export type EventReport = z.infer<typeof EventReport>;
