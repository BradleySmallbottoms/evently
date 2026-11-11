import { describe, expect, it } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { saveIncomingEvents } from '../../../apps/data-workers/src/persist';
import type { SourceRecord } from '../../../apps/data-workers/src/store';
import {
  fillUnnamedVenues,
  venueDraftFromScan,
} from '../../../apps/data-workers/src/venue-backfill';

const source: SourceRecord = {
  id: '33333333-3333-4333-8333-333333333301',
  slug: 'visit-soderhamn',
  trust: 'review',
  config: {},
  enabled: true,
};

const event = {
  externalId: 'cbis:unnamed',
  title: 'Konsert',
  description: 'En kväll med musik',
  mode: 'physical' as const,
  startsAt: '2027-06-01T18:00:00.000Z',
  endsAt: '2027-06-01T21:00:00.000Z',
  timezone: 'Europe/Stockholm',
  sourceUrl: 'https://example.com/konsert',
  organizerKeys: ['kansli@example.com'],
  organizerName: 'Föreningen',
  categoryHints: [],
  tags: [] as { externalId: string; name: string }[],
};

describe('venueDraftFromScan', () => {
  it('uses the scan venue and the stored point', () => {
    expect(
      venueDraftFromScan({
        llmOutput: {
          contentVerdict: 'safe',
          possibleVenueNames: [{ name: 'Bagarstugan', rank: 92 }],
          address: { city: 'Stråtjära' },
        },
        meta: {
          address: {
            address: 'Hagalundsvägen 2',
            zipCode: '82669',
            city: 'Stråtjära',
            country: 'Sweden',
            location: { lat: 61.16, lng: 16.84 },
          },
        },
      }),
    ).toMatchObject({
      name: 'Bagarstugan',
      city: 'Stråtjära',
      address: 'Hagalundsvägen 2',
      location: { lat: 61.16, lng: 16.84 },
    });
  });

  it('uses the street when the scan only names the city', () => {
    expect(
      venueDraftFromScan({
        llmOutput: {
          contentVerdict: 'safe',
          possibleVenueNames: [],
          address: { address: 'Kungsgatan 6, Söderhamn', city: 'Söderhamn', zipCode: '82632' },
        },
        meta: {},
      }),
    ).toMatchObject({ name: 'Kungsgatan 6', city: 'Söderhamn', zipCode: '82632' });
  });

  it('returns nothing when the scan has no place', () => {
    expect(
      venueDraftFromScan({
        llmOutput: { contentVerdict: 'safe', address: null, possibleVenueNames: [] },
        meta: { address: { city: 'Söderhamn', country: 'Sweden' } },
      }),
    ).toBeUndefined();
  });
});

describe('fillUnnamedVenues', () => {
  it('links a stored venue and geocodes a new street', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await store.saveVenue({
      name: 'Bagarstugan',
      city: 'Stråtjära',
      nameKey: 'bagarstugan',
      cityKey: 'stråtjära',
      location: { lat: 61.16, lng: 16.84 },
    });
    await saveIncomingEvents(store, source, [
      {
        ...event,
        meta: {
          address: { city: 'Stråtjära', country: 'Sweden' },
        },
      },
      {
        ...event,
        externalId: 'cbis:street',
        meta: {
          address: {
            address: 'Kungsgatan 6',
            zipCode: '82632',
            city: 'Söderhamn',
            country: 'Sweden',
          },
        },
      },
    ]);
    store.events[0]!.llmOutput = {
      contentVerdict: 'safe',
      possibleVenueNames: [{ name: 'Bagarstugan', rank: 92 }],
    };
    store.events[1]!.llmOutput = {
      contentVerdict: 'safe',
      possibleVenueNames: [],
      address: { city: 'Söderhamn' },
    };
    const calls: string[] = [];
    const summary = await fillUnnamedVenues(store, {
      fetch: async (input) => {
        calls.push(new URL(String(input)).searchParams.get('q') ?? '');
        return Response.json({
          features: [
            {
              geometry: { coordinates: [17.05, 61.3] },
              properties: {
                countrycode: 'SE',
                housenumber: '6',
                street: 'Kungsgatan',
                city: 'Söderhamn',
              },
            },
          ],
        });
      },
    });
    expect(summary).toMatchObject({ read: 2, linked: 2, created: 1, geocoded: 1, skipped: 0 });
    expect(calls).toEqual(['Kungsgatan 6, 82632, Söderhamn, Sweden']);
    expect(store.events[0]?.occasions[0]).toMatchObject({
      venueName: 'Bagarstugan',
      location: { lat: 61.16, lng: 16.84 },
    });
    expect(store.events[1]?.occasions[0]).toMatchObject({
      venueName: 'Kungsgatan 6',
      location: { lat: 61.3, lng: 17.05 },
    });
    expect(await store.findVenue('kungsgatan 6', 'söderhamn')).toMatchObject({
      location: { lat: 61.3, lng: 17.05 },
    });
  });

  it('geocodes a named showing that has an address and no point', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [
      {
        ...event,
        externalId: 'cbis:folkteatern',
        meta: {
          address: {
            address: 'N. Rådmansgatan 23',
            city: 'Gävle',
            country: 'Sweden',
          },
        },
      },
    ]);
    const occasion = store.events[0]!.occasions[0]!;
    occasion.venueName = 'Folkteatern';
    store.events[0]!.llmOutput = {
      contentVerdict: 'safe',
      possibleVenueNames: [{ name: 'Folkteatern', rank: 90 }],
      address: { address: 'N. Rådmansgatan 23', city: 'Gävle' },
    };
    const summary = await fillUnnamedVenues(store, {
      fetch: async () =>
        Response.json({
          features: [
            {
              geometry: { coordinates: [17.141, 60.675] },
              properties: {
                countrycode: 'SE',
                housenumber: '23',
                street: 'N. Rådmansgatan',
                city: 'Gävle',
              },
            },
          ],
        }),
    });
    expect(summary).toMatchObject({ read: 1, linked: 1, created: 1, geocoded: 1, skipped: 0 });
    expect(occasion).toMatchObject({
      venueName: 'Folkteatern',
      location: { lat: 60.675, lng: 17.141 },
    });
    expect(occasion.venueId).toBeTruthy();
  });

  it('creates a venue from the point when the address has no city', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [
      {
        ...event,
        externalId: 'cbis:jakobs',
        location: { lat: 61.7265, lng: 17.1056 },
        meta: { address: { country: 'Sweden', location: { lat: 61.7265, lng: 17.1056 } } },
      },
    ]);
    const occasion = store.events[0]!.occasions[0]!;
    occasion.venueName = 'Jakobs kyrka';
    occasion.location = { lat: 61.7265, lng: 17.1056 };
    const urls: string[] = [];
    const summary = await fillUnnamedVenues(store, {
      fetch: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('photon.komoot.io')) throw new Error('connect ECONNREFUSED');
        return Response.json({ address: { city: 'Hudiksvall', country_code: 'se' } });
      },
    });
    expect(summary).toMatchObject({ read: 1, linked: 1, created: 1, geocoded: 1, skipped: 0 });
    expect(urls.every((url) => url.includes('/reverse'))).toBe(true);
    expect(await store.findVenue('jakobs kyrka', 'hudiksvall')).toMatchObject({
      location: { lat: 61.7265, lng: 17.1056 },
    });
    expect(occasion.venueId).toBeTruthy();
  });

  it('uses the town in the address line before a source city', async () => {
    const store = createMemoryIngestStore();
    store.sources.push({ ...source, slug: 'abf-halsingland' });
    await saveIncomingEvents(store, store.sources[0]!, [
      {
        ...event,
        externalId: 'abf:odd',
        meta: {
          address: { address: 'Odd Fellow, Kyrkogatan 14 Ljusdal', country: 'Sweden' },
        },
      },
    ]);
    const occasion = store.events[0]!.occasions[0]!;
    occasion.venueName = 'Odd Fellow';
    const queries: string[] = [];
    const summary = await fillUnnamedVenues(store, {
      fetch: async (input) => {
        queries.push(new URL(String(input)).searchParams.get('q') ?? '');
        return Response.json({
          features: [
            { geometry: { coordinates: [16.09, 61.83] }, properties: { countrycode: 'SE' } },
          ],
        });
      },
    });
    expect(summary).toMatchObject({ read: 1, linked: 1, created: 1, skipped: 0 });
    expect(queries[0]).toContain('Ljusdal');
    expect(store.events[0]?.meta.address?.city).toBe('Ljusdal');
    expect(await store.findVenue('odd fellow', 'ljusdal')).toBeTruthy();
  });

  it('uses the source city when the page names none, and a town in the venue name first', async () => {
    const store = createMemoryIngestStore();
    const bollnas = {
      ...source,
      id: '33333333-3333-4333-8333-333333333302',
      slug: 'bollnas-kommun',
    };
    store.sources.push(bollnas);
    await saveIncomingEvents(store, bollnas, [
      { ...event, externalId: 'arena' },
      { ...event, externalId: 'alfta', title: 'Konsert i Alfta' },
    ]);
    store.events[0]!.occasions[0]!.venueName = 'SBB Arena';
    store.events[1]!.occasions[0]!.venueName = 'Alfta Kyrka';
    const queries: string[] = [];
    const summary = await fillUnnamedVenues(store, {
      fetch: async (input) => {
        queries.push(new URL(String(input)).searchParams.get('q') ?? '');
        return Response.json({
          features: [
            { geometry: { coordinates: [16.39, 61.35] }, properties: { countrycode: 'SE' } },
          ],
        });
      },
    });
    expect(summary).toMatchObject({ read: 2, linked: 2, created: 2, geocoded: 2, skipped: 0 });
    expect(queries).toEqual(['Bollnäs, Sweden', 'Alfta, Sweden']);
    expect(store.events[0]?.meta.address?.city).toBe('Bollnäs');
    expect(store.events[1]?.meta.address?.city).toBe('Alfta');
  });
});
