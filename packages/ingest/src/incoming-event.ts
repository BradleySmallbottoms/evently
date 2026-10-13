import { createHash } from 'node:crypto';
import { EventMode, GeoPointSchema, HttpUrl } from '@local-events/contracts';
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
  onlineUrl: HttpUrl.optional(),
  /** Minor units. Omit when unknown. 0 means free. */
  priceAmount: z.number().int().min(0).max(10_000_000).optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/)
    .transform((value) => value.toUpperCase())
    .optional(),
  links: z
    .array(
      z.object({
        type: z.enum(['tickets', 'registration', 'info']),
        url: HttpUrl,
        label: z.string().trim().min(1).max(80).optional(),
      }),
    )
    .max(10)
    .optional(),
  sourceUrl: z.url(),
  /** Stable key for the organizer within this source; resolved via publisher_aliases. */
  organizerKey: z.string().min(1),
  organizerName: z.string().optional(),
  categoryHints: z.array(z.string()).default([]),
  /** Source tags to upsert and attach. Visit Söderhamn uses `visit-soderhamn:{citybreakId}`. */
  tags: z
    .array(
      z.object({
        externalId: z.string().trim().min(1).max(80),
        name: z.string().trim().min(1).max(120),
      }),
    )
    .max(20)
    .default([]),
  imageUrl: z.url().optional(),
  /**
   * Extra images from crawled event pages, og:image first. The hero stays `imageUrl`.
   * An empty list means the crawl ran and found nothing else.
   */
  imageUrls: z.array(z.url()).max(8).optional(),
});
export type IncomingEvent = z.infer<typeof IncomingEvent>;

/** Hash of the normalized content; unchanged hash = skip the update. */
export function contentHash(event: IncomingEvent): string {
  const keys = Object.keys(event).sort() as (keyof IncomingEvent)[];
  const stable = JSON.stringify(event, keys);
  return createHash('sha256').update(stable).digest('hex');
}
