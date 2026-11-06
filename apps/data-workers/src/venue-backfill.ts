import type { EventMeta } from '@local-events/contracts';
import {
  resolveImportCity,
  sourceCity,
  venueIdentity,
  venueNameFromScan,
  venueNamesMatch,
} from '@local-events/domain';
import { cityFromPoint, geocodeSwedishAddress } from './page-place';
import { parseStoredScanOutput } from './prompt-runners';
import type { IngestStore, StoredVenue, UnnamedOccasion } from './store';

export interface VenueBackfillSummary {
  read: number;
  linked: number;
  created: number;
  geocoded: number;
  skipped: number;
}

/**
 * Place to store for a showing that has no venue name. The scan's venue name
 * wins. A name that is only the city is left out, and the street is used instead.
 * A point already on the showing or the stored address is kept.
 */
export function venueDraftFromScan(input: {
  venueName?: string | null;
  llmOutput: unknown;
  meta: EventMeta;
  /** City read from the point when the address has none. */
  city?: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  location?: { lat: number; lng: number } | null;
}):
  | {
      name: string;
      city: string;
      nameKey: string;
      cityKey: string;
      address?: string;
      zipCode?: string;
      location?: { lat: number; lng: number };
    }
  | undefined {
  const scan = parseStoredScanOutput(input.llmOutput);
  const stored = input.meta.address;
  const city = stored?.city ?? input.city ?? scan?.address?.city;
  const street = scan?.address?.address ?? stored?.address;
  const zipCode = scan?.address?.zipCode ?? stored?.zipCode;
  const name =
    namedPlace(input.venueName ?? undefined, city) ??
    (scan
      ? (namedPlace(venueNameFromScan(scan.possibleVenueNames, input.meta.import, city), city) ??
        occasionPlace(scan.possibleOccasions, input.startsAt, input.endsAt, city))
      : undefined) ??
    streetPlace(street, city);
  const identity = venueIdentity(name, city);
  if (!identity) return undefined;
  const location = input.location ?? stored?.location;
  return {
    ...identity,
    ...(street ? { address: street } : {}),
    ...(zipCode ? { zipCode } : {}),
    ...(location ? { location } : {}),
  };
}

export async function fillUnnamedVenues(
  store: IngestStore,
  options: { limit?: number; fetch?: typeof fetch } = {},
): Promise<VenueBackfillSummary> {
  const rows = await store.listUnnamedOccasions(options.limit ?? 5000);
  const fetchImpl = options.fetch ?? fetch;
  const summary: VenueBackfillSummary = {
    read: rows.length,
    linked: 0,
    created: 0,
    geocoded: 0,
    skipped: 0,
  };
  const resolved = new Map<string, StoredVenue | null>();
  for (const row of rows) {
    const digital = /^(digitalt|online|webb)$/i.test(row.venueName?.trim() ?? '');
    const point = row.location ?? row.meta.address?.location;
    const fromText = digital
      ? row.meta.address?.city
      : resolveImportCity({
          city: row.meta.address?.city,
          placeText: [row.meta.address?.address, row.venueName].filter(Boolean).join(', '),
        });
    const fromPoint =
      !fromText && !digital && point && row.venueName?.trim()
        ? await cityFromPoint(point, fetchImpl)
        : undefined;
    if (fromPoint) summary.geocoded += 1;
    const city = fromText ?? fromPoint ?? (digital ? undefined : sourceCity(row.workerId));
    if (city && !row.meta.address?.city) {
      await store.rememberAddressCity(row.eventId, city);
      row.meta.address = {
        ...(row.meta.address ?? {}),
        city,
        country: row.meta.address?.country ?? 'Sweden',
      };
    }
    const draft = venueDraftFromScan({
      ...row,
      ...(city ? { city } : {}),
      ...(row.location ? {} : point ? { location: point } : {}),
    });
    if (!draft) {
      summary.skipped += 1;
      continue;
    }
    const key = `${draft.nameKey}\n${draft.cityKey}`;
    let venue = resolved.get(key);
    if (venue === undefined) {
      venue = await store.findVenue(draft.nameKey, draft.cityKey);
      if (!venue) {
        let location = draft.location;
        if (!location) {
          location = await geocodeSwedishAddress(
            {
              ...(draft.address ? { address: draft.address } : {}),
              ...(draft.zipCode ? { zipCode: draft.zipCode } : {}),
              city: draft.city,
            },
            fetchImpl,
          );
          if (location) summary.geocoded += 1;
        }
        if (!location) {
          resolved.set(key, null);
          venue = null;
        } else {
          venue = await store.saveVenue({
            name: draft.name,
            city: draft.city,
            nameKey: draft.nameKey,
            cityKey: draft.cityKey,
            location,
            ...(draft.address ? { address: draft.address } : {}),
            ...(draft.zipCode ? { zipCode: draft.zipCode } : {}),
          });
          summary.created += 1;
        }
      }
      resolved.set(key, venue);
    }
    if (!venue) {
      summary.skipped += 1;
      continue;
    }
    const wrote = await store.assignOccasionVenue({
      occasionId: row.occasionId,
      venueId: venue.id,
      venueName: draft.name,
      ...(row.location ? {} : { location: venue.location }),
    });
    if (wrote) summary.linked += 1;
    else summary.skipped += 1;
  }
  return summary;
}

function namedPlace(name: string | undefined, city: string | undefined): string | undefined {
  if (!name || venueNamesMatch(name, city)) return undefined;
  return name;
}

function occasionPlace(
  occasions: { startsAt: string; endsAt: string; venueName?: string }[] | undefined,
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
  city: string | undefined,
): string | undefined {
  const named = (occasions ?? []).flatMap((occasion) => {
    const name = namedPlace(occasion.venueName, city);
    return name ? [{ ...occasion, name }] : [];
  });
  if (startsAt && endsAt) {
    const start = startsAt.getTime();
    const end = endsAt.getTime();
    const match = named.find(
      (occasion) =>
        new Date(occasion.startsAt).getTime() === start &&
        new Date(occasion.endsAt).getTime() === end,
    );
    if (match) return match.name;
  }
  const unique = [...new Set(named.map((occasion) => occasion.name))];
  return unique.length === 1 ? unique[0] : undefined;
}

/** Street line, without a trailing city, when the scan named no place. */
function streetPlace(street: string | undefined, city: string | undefined): string | undefined {
  const text = street?.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  const town = city?.replace(/\s+/g, ' ').trim();
  const bare =
    town && text.toLocaleLowerCase('sv').endsWith(town.toLocaleLowerCase('sv'))
      ? text
          .slice(0, text.length - town.length)
          .replace(/[,\s]+$/u, '')
          .trim()
      : text;
  return namedPlace(bare, city);
}
