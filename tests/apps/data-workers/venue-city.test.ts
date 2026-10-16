import type { IncomingEvent } from '../../../packages/ingest/src/incoming-event';
import { fillMissingVenueNames } from '../../../apps/data-workers/src/venue-city';
import { describe, expect, it } from 'vitest';

function event(overrides: Partial<IncomingEvent> = {}): IncomingEvent {
  return {
    externalId: '1',
    title: 'Konsert',
    mode: 'physical',
    startsAt: '2026-08-01T18:00:00+02:00',
    timezone: 'Europe/Stockholm',
    sourceUrl: 'https://example.com/show',
    organizerKeys: ['example'],
    categoryHints: [],
    tags: [],
    ...overrides,
  };
}

function photon(features: unknown[]) {
  return new Response(JSON.stringify({ features }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fillMissingVenueNames', () => {
  it('uses the city in the scraped address and does not look up the point', async () => {
    const calls: string[] = [];
    const [named] = await fillMissingVenueNames(
      [
        event({
          address: 'Storgatan 1, 826 30 Söderhamn, Sweden',
          location: { lat: 61.3, lng: 17.06 },
        }),
      ],
      async (input) => {
        calls.push(String(input));
        return photon([]);
      },
      { delayMs: 0 },
    );
    expect(named?.venueName).toBe('Söderhamn');
    expect(calls).toEqual([]);
  });

  it('reverse-geocodes when the address has no city', async () => {
    const calls: string[] = [];
    const [named] = await fillMissingVenueNames(
      [event({ address: 'Storgatan 1', location: { lat: 61.303, lng: 17.06 } })],
      async (input) => {
        calls.push(String(input));
        return photon([
          {
            properties: {
              name: 'Storgatan',
              city: 'Söderhamn',
              type: 'street',
              countrycode: 'SE',
            },
          },
        ]);
      },
      { delayMs: 0 },
    );
    expect(named?.venueName).toBe('Söderhamn');
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!);
    expect(url.hostname).toBe('photon.komoot.io');
    expect(url.pathname).toBe('/reverse');
    expect(url.searchParams.get('lat')).toBe('61.303');
    expect(url.searchParams.get('radius')).toBe('25');
  });

  it('keeps a venue name and skips a digital event', async () => {
    const calls: string[] = [];
    const named = await fillMissingVenueNames(
      [
        event({ venueName: 'Helsingehus Arena', address: '826 30 Söderhamn' }),
        event({
          externalId: '2',
          mode: 'digital',
          onlineUrl: 'https://example.com/live',
          location: { lat: 61.3, lng: 17.06 },
        }),
      ],
      async (input) => {
        calls.push(String(input));
        return photon([]);
      },
      { delayMs: 0 },
    );
    expect(named.map((item) => item.venueName)).toEqual(['Helsingehus Arena', undefined]);
    expect(calls).toEqual([]);
  });

  it('reads a village from locality and does not reuse a failed lookup', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) throw new Error('down');
      return photon([
        { properties: { name: 'Byvägen', locality: 'Delsbo', type: 'street', countrycode: 'SE' } },
      ]);
    };
    const named = await fillMissingVenueNames(
      [
        event({ location: { lat: 61.8, lng: 16.55 } }),
        event({ externalId: '2', location: { lat: 61.8001, lng: 16.5501 } }),
      ],
      fetchImpl,
      { delayMs: 0 },
    );
    expect(named.map((item) => item.venueName)).toEqual([undefined, 'Delsbo']);
    expect(calls).toBe(2);
  });

  it('leaves the venue empty when the lookup misses, and reuses a point', async () => {
    let calls = 0;
    const named = await fillMissingVenueNames(
      [
        event({ location: { lat: 61.3, lng: 17.06 } }),
        event({ externalId: '2', location: { lat: 61.3004, lng: 17.0604 } }),
      ],
      async () => {
        calls += 1;
        return photon([{ properties: { name: 'Storgatan', type: 'street', countrycode: 'SE' } }]);
      },
      { delayMs: 0 },
    );
    expect(named.map((item) => item.venueName)).toEqual([undefined, undefined]);
    expect(calls).toBe(1);
  });
});
