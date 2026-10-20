import { describe, expect, it } from 'vitest';
import { geocodeSwedishAddress, lookupPageUrl } from '../../../apps/data-workers/src/page-place';

describe('lookupPageUrl', () => {
  it('uses the first https ticket link, then the first https info link', () => {
    expect(
      lookupPageUrl([
        { type: 'registration', url: 'https://signup.example/a' },
        { type: 'tickets', url: 'http://tickets.example/a' },
        { type: 'info', url: 'https://info.example/a' },
        { type: 'tickets', url: 'https://tickets.example/a' },
      ]),
    ).toBe('https://tickets.example/a');
    expect(
      lookupPageUrl([
        { type: 'registration', url: 'https://signup.example/a' },
        { type: 'info', url: 'http://info.example/a' },
        { type: 'info', url: 'https://info.example/b' },
      ]),
    ).toBe('https://info.example/b');
    expect(lookupPageUrl([{ type: 'registration', url: 'https://signup.example/a' }])).toBeUndefined();
  });
});

describe('geocodeSwedishAddress', () => {
  it('keeps the first hit in Sweden', async () => {
    const point = await geocodeSwedishAddress(
      { address: 'Köpmangatan 14', zipCode: '82471', city: 'Delsbo' },
      async () =>
        Response.json({
          features: [
            { geometry: { coordinates: [10, 59] }, properties: { countrycode: 'NO' } },
            { geometry: { coordinates: [16.55, 61.8] }, properties: { countrycode: 'SE' } },
          ],
        }),
    );
    expect(point).toEqual({ lat: 61.8, lng: 16.55 });
  });

  it('does not geocode a city on its own and leaves a miss empty', async () => {
    const calls: string[] = [];
    const city = await geocodeSwedishAddress({ city: 'Delsbo' }, async (input) => {
      calls.push(String(input));
      return Response.json({ features: [] });
    });
    expect(city).toBeUndefined();
    expect(calls).toEqual([]);
    const miss = await geocodeSwedishAddress(
      { address: 'Köpmangatan 14', city: 'Delsbo' },
      async () => Response.json({ features: [] }),
    );
    expect(miss).toBeUndefined();
  });
});
