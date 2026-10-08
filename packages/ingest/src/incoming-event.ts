import { createHash } from 'node:crypto';
import { EventMode, GeoPointSchema } from '@local-events/contracts';
import { z } from 'zod';

/** The shape every source adapter maps raw data into. `ingest` takes it from here. */
export const IncomingEvent = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  mode: EventMode.default('physical'),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).optional(),
  timezone: z.string().default('Europe/Stockholm'),
  venueName: z.string().optional(),
  address: z.string().optional(),
  location: GeoPointSchema.optional(),
  onlineUrl: z.url().optional(),
  sourceUrl: z.url(),
  /** Stable key for the organizer within this source; resolved via publisher_aliases. */
  organizerKey: z.string().min(1),
  organizerName: z.string().optional(),
  categoryHints: z.array(z.string()).default([]),
  imageUrl: z.url().optional(),
});
export type IncomingEvent = z.infer<typeof IncomingEvent>;

/** Hash of the normalized content; unchanged hash = skip the update. */
export function contentHash(event: IncomingEvent): string {
  const keys = Object.keys(event).sort() as (keyof IncomingEvent)[];
  const stable = JSON.stringify(event, keys);
  return createHash('sha256').update(stable).digest('hex');
}
