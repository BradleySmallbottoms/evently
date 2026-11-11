import { readEventMeta } from '@local-events/contracts';
import { type Db, pointEwkt, schema } from '@local-events/db';
import {
  addressRankReplaces,
  buildOccasionPlace,
  confidentVenueName,
  eventAddress,
  fillPlacePoint,
  occasionsToAdd,
  pointRankBeats,
  venueIdentity,
  type ChosenPlace,
  type PlaceBits,
  type PlacePoint,
  type PlaceFill,
  type PointRank,
} from '@local-events/domain';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { googlePlacePoint } from './google-places';
import { geocodeSwedishCity, geocodeSwedishStreet } from './page-place';
import { parseStoredScanOutput } from './prompt-runners';

const { events, eventOccasions, venues, knownCities, knownAddresses, placeLookupMisses } = schema;

const DIGITAL_VENUE = /^(digitalt|online|webb)$/i;

export interface PlaceResolveSummary {
  events: number;
  occasions: number;
  addedOccasions: number;
  written: number;
  failed: number;
  points: Record<PointRank | 'missing', number>;
  filledBy: Record<PlaceFill | 'missing', number>;
  dryRun: boolean;
  live: boolean;
}

interface StoredOccasion {
  id: string;
  startsAt: Date;
  endsAt: Date;
  venueName: string | null;
}

interface ScanOccasion {
  startsAt: string;
  endsAt: string;
  venueName?: string | null;
}

/** Local Docker Postgres. Rewind and this replay refuse every other database. */
export function assertLocalDatabase(databaseUrl: string): void {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('This job only runs on the local database at port 15432');
  }
  const host = url.hostname;
  const port = url.port || '5432';
  if ((host !== '127.0.0.1' && host !== 'localhost') || port !== '15432') {
    throw new Error('This job only runs on the local database at port 15432');
  }
}

export async function resolveStoredPlaces(
  db: Db,
  options: {
    eventId?: string;
    limit?: number;
    dryRun?: boolean;
    live?: boolean;
    fetch?: typeof fetch;
  } = {},
): Promise<PlaceResolveSummary> {
  const dryRun = options.dryRun === true;
  const live = options.live === true;
  const fetchImpl = options.fetch ?? fetch;
  const placesKey = live ? process.env.GOOGLE_PLACES_API_KEY?.trim() : undefined;
  const summary = emptySummary(dryRun, live);
  const selection = db
    .select({
      id: events.id,
      workerId: events.workerId,
      mode: events.mode,
      meta: events.meta,
      llmOutput: events.llmOutput,
    })
    .from(events)
    .where(
      and(
        eq(events.origin, 'imported'),
        isNotNull(events.llmOutput),
        inArray(events.status, ['pending_scan', 'in_review', 'published']),
        options.eventId ? eq(events.id, options.eventId) : undefined,
      ),
    )
    .orderBy(asc(events.createdAt));
  const eventRows = options.limit != null ? await selection.limit(options.limit) : await selection;

  for (const event of eventRows) {
    summary.events += 1;
    try {
      await resolveEvent(db, event, summary, { dryRun, live, fetchImpl, placesKey });
    } catch (error) {
      summary.failed += 1;
      console.error(
        'place resolve failed',
        event.id,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return summary;
}

function emptySummary(dryRun: boolean, live: boolean): PlaceResolveSummary {
  return {
    events: 0,
    occasions: 0,
    addedOccasions: 0,
    written: 0,
    failed: 0,
    points: { scraped: 0, scan: 0, source: 0, address: 0, places: 0, city: 0, missing: 0 },
    filledBy: { stored: 0, street: 0, venue: 0, places: 0, city: 0, missing: 0 },
    dryRun,
    live,
  };
}

async function resolveEvent(
  db: Db,
  event: {
    id: string;
    workerId: string | null;
    mode: string;
    meta: unknown;
    llmOutput: unknown;
  },
  summary: PlaceResolveSummary,
  options: {
    dryRun: boolean;
    live: boolean;
    fetchImpl: typeof fetch;
    placesKey: string | undefined;
  },
): Promise<void> {
  const meta = readEventMeta(event.meta);
  const scan = parseStoredScanOutput(event.llmOutput);
  const stored = await db
    .select({
      id: eventOccasions.id,
      startsAt: eventOccasions.startsAt,
      endsAt: eventOccasions.endsAt,
      venueName: eventOccasions.venueName,
    })
    .from(eventOccasions)
    .where(eq(eventOccasions.eventId, event.id))
    .orderBy(asc(eventOccasions.startsAt));

  const additions = scanOccasionsToAdd(stored, scan?.possibleOccasions);
  summary.addedOccasions += additions.length;
  const occasions: StoredOccasion[] = [...stored];
  if (!options.dryRun) {
    for (const addition of additions) {
      const [inserted] = await db
        .insert(eventOccasions)
        .values({
          eventId: event.id,
          startsAt: addition.startsAt,
          endsAt: addition.endsAt,
          venueName: addition.venueName,
        })
        .returning({
          id: eventOccasions.id,
          startsAt: eventOccasions.startsAt,
          endsAt: eventOccasions.endsAt,
          venueName: eventOccasions.venueName,
        });
      if (inserted) occasions.push(inserted);
    }
  } else {
    for (const addition of additions) {
      occasions.push({
        id: '',
        startsAt: addition.startsAt,
        endsAt: addition.endsAt,
        venueName: addition.venueName,
      });
    }
  }

  const cities = new Set<string>();
  const scanReplaces = addressRankReplaces(scan?.address?.rank);
  let replacedPoint: PlacePoint | undefined;
  for (const occasion of occasions) {
    summary.occasions += 1;
    const digital =
      event.mode === 'digital' || DIGITAL_VENUE.test(occasion.venueName?.trim() ?? '');
    const chosen = await fillPlacePoint(
      buildOccasionPlace({
        digital,
        workerId: event.workerId,
        occasionVenueName: occasion.venueName,
        address: meta.address,
        scan: scanBits(scan, occasion.startsAt, occasion.endsAt),
      }),
      lookups(db, options),
    );
    if (chosen.city) cities.add(chosen.city);
    if (scanReplaces && chosen.point) replacedPoint = chosen.point;
    const rank = chosen.pointRank;
    if (rank && chosen.point) summary.points[rank] += 1;
    else summary.points.missing += 1;
    if (chosen.filledBy && chosen.point) summary.filledBy[chosen.filledBy] += 1;
    else summary.filledBy.missing += 1;
    if (options.dryRun || !occasion.id) continue;
    const venueId =
      chosen.venueName && chosen.city && chosen.point ? await rememberVenue(db, chosen) : undefined;
    await db
      .update(eventOccasions)
      .set({
        ...(chosen.venueName ? { venueName: chosen.venueName } : {}),
        venueId: venueId ?? null,
        ...(chosen.point ? { location: pointEwkt(chosen.point) } : { location: null }),
        updatedAt: new Date(),
      })
      .where(eq(eventOccasions.id, occasion.id));
    summary.written += 1;
  }

  if (scanReplaces && scan?.address && !options.dryRun) {
    const address = eventAddress({
      address: scan.address.address,
      zipCode: scan.address.zipCode,
      city: scan.address.city,
      location: replacedPoint,
    });
    if (address) {
      await db
        .update(events)
        .set({ meta: { ...meta, address }, updatedAt: new Date() })
        .where(eq(events.id, event.id));
      meta.address = address;
    }
  }

  if (options.dryRun || meta.address?.city || cities.size !== 1) return;
  const city = [...cities][0];
  if (!city) return;
  await db
    .update(events)
    .set({
      meta: {
        ...meta,
        address: { ...(meta.address ?? {}), city, country: 'Sweden' },
      },
      updatedAt: new Date(),
    })
    .where(eq(events.id, event.id));
}

function scanOccasionsToAdd(
  existing: { startsAt: Date; endsAt: Date }[],
  possible: ScanOccasion[] | undefined,
): { startsAt: Date; endsAt: Date; venueName: string | null }[] {
  const dated = [];
  for (const item of possible ?? []) {
    const startsAt = new Date(item.startsAt);
    const endsAt = new Date(item.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) continue;
    dated.push({
      startsAt,
      endsAt,
      venueName: item.venueName?.trim() || null,
    });
  }
  return occasionsToAdd(existing, dated);
}

function scanBits(
  scan: ReturnType<typeof parseStoredScanOutput>,
  startsAt: Date,
  endsAt: Date,
): PlaceBits {
  if (!scan) return {};
  const match = scan.possibleOccasions?.find((item) => {
    const start = new Date(item.startsAt).getTime();
    const end = new Date(item.endsAt).getTime();
    return start === startsAt.getTime() && end === endsAt.getTime();
  });
  const venueName = match?.venueName?.trim() || confidentVenueName(scan.possibleVenueNames);
  return {
    ...(scan.address?.city ? { city: scan.address.city } : {}),
    ...(scan.address?.address ? { street: scan.address.address } : {}),
    ...(scan.address?.zipCode ? { zipCode: scan.address.zipCode } : {}),
    ...(venueName ? { venueName } : {}),
    ...(scan.address && addressRankReplaces(scan.address.rank) ? { rank: scan.address.rank } : {}),
  };
}

function lookups(
  db: Db,
  options: {
    live: boolean;
    fetchImpl: typeof fetch;
    placesKey: string | undefined;
  },
): Parameters<typeof fillPlacePoint>[1] {
  return {
    geocodeStreet: (street, zipCode, city) =>
      cachedPoint(db, 'street', addressKey(street, zipCode, city), options, async () => {
        const point = await geocodeSwedishStreet(
          { address: street, zipCode, city },
          options.fetchImpl,
        );
        if (point && city) await rememberAddress(db, street, zipCode, city, point);
        return point;
      }),
    findVenue: async (name, city) => {
      const identity = venueIdentity(name, city);
      if (!identity) return undefined;
      const [row] = await db
        .select({
          lat: sql<number | null>`ST_Y(${venues.location}::geometry)`,
          lng: sql<number | null>`ST_X(${venues.location}::geometry)`,
          pointSource: venues.pointSource,
        })
        .from(venues)
        .where(and(eq(venues.nameKey, identity.nameKey), eq(venues.cityKey, identity.cityKey)))
        .limit(1);
      if (!row || row.lat == null || row.lng == null) return undefined;
      return {
        point: { lat: Number(row.lat), lng: Number(row.lng) },
        rank: row.pointSource,
      };
    },
    findPlaces: (name, city) => {
      const identity = venueIdentity(name, city);
      if (!identity || !options.placesKey) return Promise.resolve(undefined);
      return cachedPoint(
        db,
        'places',
        `places:${identity.nameKey}|${identity.cityKey}`,
        options,
        () => googlePlacePoint(name, city, options.fetchImpl, options.placesKey ?? ''),
      );
    },
    cityPoint: (city) =>
      cachedPoint(db, 'city', `city:${city.toLocaleLowerCase('sv')}`, options, async () => {
        const point = await geocodeSwedishCity(city, options.fetchImpl);
        if (point) await rememberCity(db, city, point);
        return point;
      }),
  };
}

async function cachedPoint(
  db: Db,
  kind: 'street' | 'places' | 'city',
  key: string,
  options: { live: boolean },
  load: () => Promise<PlacePoint | undefined>,
): Promise<PlacePoint | undefined> {
  if (kind === 'street') {
    const [row] = await db
      .select({
        lat: sql<number | null>`ST_Y(${knownAddresses.location}::geometry)`,
        lng: sql<number | null>`ST_X(${knownAddresses.location}::geometry)`,
      })
      .from(knownAddresses)
      .where(eq(knownAddresses.addressKey, key))
      .limit(1);
    if (row?.lat != null && row.lng != null) return { lat: Number(row.lat), lng: Number(row.lng) };
  }
  if (kind === 'city') {
    const cityKey = key.slice('city:'.length);
    const [row] = await db
      .select({
        lat: sql<number | null>`ST_Y(${knownCities.location}::geometry)`,
        lng: sql<number | null>`ST_X(${knownCities.location}::geometry)`,
      })
      .from(knownCities)
      .where(eq(knownCities.cityKey, cityKey))
      .limit(1);
    if (row?.lat != null && row.lng != null) return { lat: Number(row.lat), lng: Number(row.lng) };
  }
  if (!options.live) return undefined;
  const [miss] = await db
    .select({ lookupKey: placeLookupMisses.lookupKey })
    .from(placeLookupMisses)
    .where(eq(placeLookupMisses.lookupKey, key))
    .limit(1);
  if (miss) return undefined;
  try {
    const point = await load();
    if (!point) await rememberMiss(db, key, kind);
    return point;
  } catch {
    return undefined;
  }
}

function addressKey(
  street: string | undefined,
  zipCode: string | undefined,
  city: string | undefined,
): string {
  return [street, zipCode, city]
    .map((part) => (part ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('sv'))
    .join('|');
}

async function rememberAddress(
  db: Db,
  street: string | undefined,
  zipCode: string | undefined,
  city: string,
  point: PlacePoint,
): Promise<void> {
  await db
    .insert(knownAddresses)
    .values({
      street: street ?? null,
      zipCode: zipCode ?? null,
      city,
      addressKey: addressKey(street, zipCode, city),
      location: pointEwkt(point),
    })
    .onConflictDoNothing({ target: knownAddresses.addressKey });
}

async function rememberCity(db: Db, city: string, point: PlacePoint): Promise<void> {
  await db
    .insert(knownCities)
    .values({
      name: city,
      cityKey: city.toLocaleLowerCase('sv'),
      location: pointEwkt(point),
    })
    .onConflictDoNothing({ target: knownCities.cityKey });
}

async function rememberMiss(db: Db, key: string, kind: string): Promise<void> {
  await db.insert(placeLookupMisses).values({ lookupKey: key, kind }).onConflictDoNothing();
}

async function rememberVenue(db: Db, chosen: ChosenPlace): Promise<string | undefined> {
  if (!chosen.venueName || !chosen.city || !chosen.point || !chosen.pointRank) return undefined;
  const identity = venueIdentity(chosen.venueName, chosen.city);
  if (!identity) return undefined;
  const [inserted] = await db
    .insert(venues)
    .values({
      name: identity.name,
      city: identity.city,
      nameKey: identity.nameKey,
      cityKey: identity.cityKey,
      location: pointEwkt(chosen.point),
      pointSource: chosen.pointRank,
      address: chosen.street ?? null,
      zipCode: chosen.zipCode ?? null,
    })
    .onConflictDoNothing({ target: [venues.nameKey, venues.cityKey] })
    .returning({ id: venues.id });
  if (inserted) return inserted.id;

  const [existing] = await db
    .select({ id: venues.id, pointSource: venues.pointSource })
    .from(venues)
    .where(and(eq(venues.nameKey, identity.nameKey), eq(venues.cityKey, identity.cityKey)))
    .limit(1);
  if (!existing) return undefined;
  if (pointRankBeats(chosen.pointRank, existing.pointSource)) {
    await db
      .update(venues)
      .set({
        location: pointEwkt(chosen.point),
        pointSource: chosen.pointRank,
        address: chosen.street ?? null,
        zipCode: chosen.zipCode ?? null,
        updatedAt: new Date(),
      })
      .where(eq(venues.id, existing.id));
  }
  return existing.id;
}
