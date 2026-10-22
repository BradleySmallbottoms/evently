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
  'pending_scan',
  'in_review',
  'published',
  'cancelled',
  'ended',
]);
const EventOrigin = z.enum(['native', 'imported']);

export const PublisherStatus = z.enum(['pending_scan', 'in_review', 'published']);
export type PublisherStatus = z.infer<typeof PublisherStatus>;

export const Tag = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
});
export type Tag = z.infer<typeof Tag>;

export const TagListResponse = z.object({
  items: z.array(Tag),
});
export type TagListResponse = z.infer<typeof TagListResponse>;

export const TagListQuery = z
  .object({
    /**
     * When `true`, only tags on a published event that has not ended.
     * Omitted returns the full vocabulary (publisher forms and interests).
     */
    upcoming: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    /**
     * With `lng` and `radiusM`, only tags on a current published event inside
     * that circle. An event without a point is left out. All three or none.
     */
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusM: z.coerce.number().int().min(100).max(200_000).optional(),
  })
  .refine((value) => {
    const set = [value.lat, value.lng, value.radiusM].filter((part) => part !== undefined).length;
    return set === 0 || set === 3;
  }, 'lat, lng, and radiusM are set together');
export type TagListQuery = z.infer<typeof TagListQuery>;

export const EventLinkType = z.enum(['tickets', 'registration', 'info', 'facebook', 'instagram']);
export type EventLinkType = z.infer<typeof EventLinkType>;

/** Web links only. `z.url()` also accepts `javascript:` and other schemes. */
export const HttpUrl = z.url({ protocol: /^https?$/ });

export const EventLink = z.object({
  id: Id,
  type: EventLinkType,
  url: HttpUrl,
  label: z.string().nullable(),
  position: z.number().int().nonnegative(),
});
export type EventLink = z.infer<typeof EventLink>;

export const EventLinkInput = z.object({
  type: EventLinkType,
  url: HttpUrl,
  label: z.string().trim().min(1).max(80).optional(),
});
export type EventLinkInput = z.infer<typeof EventLinkInput>;

/** Link shown only after check-in. */
export const AttendeeLink = z.object({
  id: Id,
  url: HttpUrl,
  label: z.string().nullable(),
});
export type AttendeeLink = z.infer<typeof AttendeeLink>;

export const AttendeeLinkInput = z.object({
  url: HttpUrl,
  label: z.string().trim().min(1).max(80).optional(),
});
export type AttendeeLinkInput = z.infer<typeof AttendeeLinkInput>;

/**
 * Street, postcode, city, and point for one event. A missing part is left out.
 * `zipCode` is five digits. `location` uses the same point as the event.
 */
export const EventAddress = z.object({
  address: z.string().trim().min(1).max(200).optional(),
  zipCode: z
    .string()
    .regex(/^\d{5}$/)
    .optional(),
  city: z.string().trim().min(1).max(80).optional(),
  country: z.literal('Sweden').optional(),
  location: GeoPointSchema.optional(),
});
export type EventAddress = z.infer<typeof EventAddress>;

/**
 * Facts that are not their own columns. Imports fill what the source knows.
 * An empty object means the event has none.
 */
export const EventMeta = z.object({
  address: EventAddress.optional(),
  /** Minimum age in years, when the source states one. */
  ageLimit: z.number().int().min(0).max(120).optional(),
  freeEntry: z.boolean().optional(),
  accessibleParking: z.boolean().optional(),
  accessibleToilet: z.boolean().optional(),
  hearingLoop: z.boolean().optional(),
  visuallyImpairedAccess: z.boolean().optional(),
  wheelchairAccessible: z.boolean().optional(),
  petsAllowed: z.boolean().optional(),
  childFriendly: z.boolean().optional(),
  allergyAdapted: z.boolean().optional(),
  smokeFree: z.boolean().optional(),
  wc: z.boolean().optional(),
  /**
   * Source product id shared by every event created from that product's separate occasions.
   * Absent when the product is one occasion or one collapsed span.
   */
  occasionGroupId: z.string().trim().min(1).max(200).optional(),
  /**
   * Scan grouping for other showings of the same event. A product id already stored on
   * `occasionGroupId` is reused; otherwise this is a new id. Public responses omit it.
   */
  possibleOccasionGroupId: z.string().trim().min(1).max(200).optional(),
  /** True when several occasions were saved as this one span. */
  collapsed: z.boolean().optional(),
  /** Each occasion folded into a collapsed span, in start order. */
  occasions: z
    .array(
      z.object({
        startsAt: z.iso.datetime({ offset: true }),
        endsAt: z.iso.datetime({ offset: true }).optional(),
        venueName: z.string().trim().min(1).max(500).optional(),
        location: GeoPointSchema.optional(),
      }),
    )
    .max(2000)
    .optional(),
  /** Set when an import looks like another event. The new row stays in review. */
  possibleDuplicate: z
    .object({
      eventId: z.uuid(),
      title: z.string(),
      startsAt: z.iso.datetime(),
      refId: z.string().nullable(),
      workerId: z.string().nullable(),
      matchedOn: z.enum(['title', 'event-link', 'link', 'id', 'llm']),
    })
    .optional(),
  /**
   * Steps the import scan pulled from the description for the reader to follow.
   * Absent when the description has none.
   */
  instructions: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  /**
   * True when a person tipped this event from the app. Public responses keep it.
   * The submitter is not named.
   */
  fromUserTip: z.boolean().optional(),
  /**
   * Chat lines from a user tip. The scan reads them along with the written description.
   * Public responses omit this block.
   */
  tip: z
    .object({
      text: z.string().trim().min(1).max(8000).optional(),
      categoryHint: z.string().trim().min(1).max(80).optional(),
    })
    .optional(),
  /**
   * Organizer identity and the imported place name. The scan job reads them
   * before a publisher and a venue are chosen. Public responses omit this block.
   */
  import: z
    .object({
      organizerKeys: z.array(z.string().min(1).max(200)).min(1).max(8),
      organizerName: z.string().optional(),
      /** Place name the adapter stored. The scan may replace it on the venue column. */
      venueName: z.string().trim().min(1).max(500).optional(),
      /** Visit Söderhamn arena name. Preferred over `venueName` when the model has none. */
      arenaName: z.string().trim().min(1).max(500).optional(),
    })
    .optional(),
});
export type EventMeta = z.infer<typeof EventMeta>;

/** Public events omit the import duplicate note, the occasion group, the scan organizer keys, and the tip chat. */
export const PublicEventMeta = EventMeta.omit({
  possibleDuplicate: true,
  possibleOccasionGroupId: true,
  import: true,
  tip: true,
});
export type PublicEventMeta = z.infer<typeof PublicEventMeta>;

/** Drops a stored object that does not match {@link EventMeta}. */
export function readEventMeta(value: unknown): EventMeta {
  const parsed = EventMeta.safeParse(value && typeof value === 'object' ? value : {});
  return parsed.success ? parsed.data : {};
}

/** Same as {@link readEventMeta}, without the import duplicate note or the occasion group. */
export function publicEventMeta(value: unknown): PublicEventMeta {
  const {
    possibleDuplicate: _flag,
    possibleOccasionGroupId: _group,
    import: _import,
    tip: _tip,
    ...meta
  } = readEventMeta(value);
  return meta;
}

/** Minor units. Null is unknown; 0 is free. */
export const PriceAmount = z.number().int().min(0).max(10_000_000);
export const CurrencyCode = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toUpperCase());

export const Event = z.object({
  id: Id,
  publisherId: Id,
  title: z.string(),
  summary: z.string().nullable(),
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
  onlineUrl: HttpUrl.nullable(),
  /** Minor units. Null when unknown; 0 when free. */
  priceAmount: z.number().int().nonnegative().nullable(),
  currency: z.string(),
  /** Extra source facts. `{}` when the event has none. */
  meta: PublicEventMeta,
  publisherName: z.string(),
  links: z.array(EventLink),
  /** Hero image. Null when the event has none or the public asset host is unset. */
  imageUrl: z.url().nullable(),
  /** Photos after the hero, `gallery-1` then `gallery-2`, and so on. Empty when there are none. */
  imageUrls: z.array(z.url()),
  tagIds: z.array(Id),
  featured: z.boolean(),
  /** When false, the event has no check-in and no attendee-only text or links. */
  checkInEnabled: z.boolean(),
  /** Lifetime saves. 0 when the stats row is missing. */
  numSaved: z.number().int().nonnegative(),
  /** Lifetime "I'm coming" marks. 0 when the stats row is missing. */
  numComing: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Event = z.infer<typeof Event>;

/** Publisher view. Attendee text and links are omitted from the public event. */
export const ManagedEvent = Event.extend({
  attendeeText: z.string().nullable(),
  attendeeLinks: z.array(AttendeeLink),
});
export type ManagedEvent = z.infer<typeof ManagedEvent>;

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
    onlineUrl: HttpUrl.optional(),
    priceAmount: PriceAmount.nullable().optional(),
    currency: CurrencyCode.optional().default('SEK'),
    links: z.array(EventLinkInput).max(10).optional().default([]),
    tagIds: z.array(Id).max(20).default([]),
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
    onlineUrl: HttpUrl.nullable().optional(),
    priceAmount: PriceAmount.nullable().optional(),
    currency: CurrencyCode.optional(),
    links: z.array(EventLinkInput).max(10).optional(),
    tagIds: z.array(Id).max(20).optional(),
    /** Extra text unlocked by check-in. Rejected unless an admin enabled check-in. */
    attendeeText: z.string().trim().max(10_000).nullable().optional(),
    attendeeLinks: z.array(AttendeeLinkInput).max(10).optional(),
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

/** Soonest published occasions returned for one `occasionGroupId`. */
export const OCCASION_LIST_LIMIT = 100;

export const OccasionListQuery = z.object({
  /** Source product id stored on `meta.occasionGroupId`. */
  occasionGroupId: z.string().trim().min(1).max(200),
});
export type OccasionListQuery = z.infer<typeof OccasionListQuery>;

export const PublicEventListResponse = z.object({
  items: z.array(Event),
  /** Pass as `offset` to load the next page. Null on the last page. */
  nextOffset: z.number().int().nonnegative().nullable(),
});
export type PublicEventListResponse = z.infer<typeof PublicEventListResponse>;

export const PublicEventListQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusM: z.coerce.number().int().min(100).max(200_000).optional().default(50_000),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  /** Matches title, venue, or organizer name. */
  q: z.string().trim().min(1).max(200).optional(),
  tagId: Id.optional(),
  /** Comma-separated tag ids. An event matches when it has any of them. */
  tagIds: z
    .string()
    .optional()
    .refine((value) => tagIdList(value).length <= 100, 'tagIds accepts at most 100 ids')
    .refine(
      (value) => tagIdList(value).every((id) => z.uuid().safeParse(id).success),
      'tagIds must be uuids',
    ),
  sort: z.enum(['soonest', 'distance', 'popular']).optional().default('soonest'),
  /** `free` is amount 0 or unknown; `paid` is amount > 0. */
  price: z.enum(['free', 'paid']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).max(10_000).optional().default(0),
});
export type PublicEventListQuery = z.infer<typeof PublicEventListQuery>;

/** Split a `tagIds` query value. Empty and omitted both mean no tag filter. */
export function tagIdList(value: string | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  ];
}

/** Single `tagId` and comma-separated `tagIds`, deduped. */
export function publicEventTagIds(query: { tagId?: string; tagIds?: string }): string[] {
  return [...new Set([...(query.tagId ? [query.tagId] : []), ...tagIdList(query.tagIds)])];
}

export const ImportNotificationPlan = z.enum(['single', 'standard', 'countdown', 'full']);
export type ImportNotificationPlan = z.infer<typeof ImportNotificationPlan>;

export const PublisherSummaryAdmin = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  type: z.enum(['org', 'person']),
  status: PublisherStatus,
  origin: EventOrigin,
  importNotificationPlan: ImportNotificationPlan.nullable(),
  /** Set on the in-review list. */
  eventCount: z.number().int().nonnegative().optional(),
  createdAt: z.iso.datetime(),
});
export type PublisherSummaryAdmin = z.infer<typeof PublisherSummaryAdmin>;

export const AdminPublisherListResponse = z.object({
  items: z.array(PublisherSummaryAdmin),
});
export type AdminPublisherListResponse = z.infer<typeof AdminPublisherListResponse>;

export const VerifyPublisherResponse = z.object({
  id: Id,
  status: z.literal('published'),
  releasedEventCount: z.number().int().nonnegative(),
});
export type VerifyPublisherResponse = z.infer<typeof VerifyPublisherResponse>;

export const AdminPublisherEventItem = z.object({
  id: Id,
  title: z.string(),
  status: EventStatus,
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  venueName: z.string().nullable(),
});
export type AdminPublisherEventItem = z.infer<typeof AdminPublisherEventItem>;

export const AdminPublisherEventListResponse = z.object({
  items: z.array(AdminPublisherEventItem),
  total: z.number().int().nonnegative(),
});
export type AdminPublisherEventListResponse = z.infer<typeof AdminPublisherEventListResponse>;

export const AdminPublisherDeleteResponse = z.object({
  id: Id,
});
export type AdminPublisherDeleteResponse = z.infer<typeof AdminPublisherDeleteResponse>;
