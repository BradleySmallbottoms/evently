import { describe, expect, it } from 'vitest';
import {
  cityFromPoint,
  geocodeSwedishAddress,
  lookupPageUrl,
} from '../../../apps/data-workers/src/page-place';

describe('lookupPageUrl', () => {
  it('uses the source URL, then a ticket link, then an info link, then Facebook', () => {
    const links = [
      { type: 'registration', url: 'https://signup.example/a' },
      { type: 'tickets', url: 'http://tickets.example/a' },
      { type: 'info', url: 'https://info.example/a' },
      { type: 'tickets', url: 'https://tickets.example/a' },
      { type: 'facebook', url: 'https://www.facebook.com/example' },
    ];
    expect(lookupPageUrl(links, 'https://source.example/event')).toBe(
      'https://source.example/event',
    );
    expect(lookupPageUrl(links, 'http://source.example/event')).toBe('https://tickets.example/a');
    expect(
      lookupPageUrl([
        { type: 'registration', url: 'https://signup.example/a' },
        { type: 'info', url: 'http://info.example/a' },
        { type: 'info', url: 'https://info.example/b' },
        { type: 'facebook', url: 'https://www.facebook.com/example' },
      ]),
    ).toBe('https://info.example/b');
    expect(
      lookupPageUrl([
        { type: 'info', url: 'https://www.facebook.com/example' },
        { type: 'facebook', url: 'https://facebook.com/other' },
      ]),
    ).toBe('https://www.facebook.com/example');
    expect(
      lookupPageUrl([{ type: 'registration', url: 'https://signup.example/a' }]),
    ).toBeUndefined();
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

  it('geocodes a city when nothing more specific exists or the street lookup misses', async () => {
    const calls: string[] = [];
    const onlyCity = await geocodeSwedishAddress({ city: 'Järvsö' }, async (input) => {
      calls.push(new URL(String(input)).searchParams.get('q') ?? '');
      return Response.json({
        features: [
          { geometry: { coordinates: [16.17, 61.72] }, properties: { countrycode: 'SE' } },
        ],
      });
    });
    expect(onlyCity).toEqual({ lat: 61.72, lng: 16.17 });
    expect(calls).toEqual(['Järvsö, Sweden']);

    const fallbackCalls: string[] = [];
    const fallback = await geocodeSwedishAddress(
      { address: 'Köpmangatan 14', city: 'Delsbo' },
      async (input) => {
        const query = new URL(String(input)).searchParams.get('q') ?? '';
        fallbackCalls.push(query);
        if (query.startsWith('Köpmangatan')) return Response.json({ features: [] });
        return Response.json({
          features: [
            { geometry: { coordinates: [16.55, 61.8] }, properties: { countrycode: 'SE' } },
          ],
        });
      },
    );
    expect(fallbackCalls).toEqual(['Köpmangatan 14, Delsbo, Sweden', 'Delsbo, Sweden']);
    expect(fallback).toEqual({ lat: 61.8, lng: 16.55 });
  });

  it('asks Nominatim when Photon does not answer', async () => {
    const urls: string[] = [];
    const point = await geocodeSwedishAddress({ city: 'Söderhamn' }, async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('photon.komoot.io')) throw new Error('connect ECONNREFUSED');
      expect((init?.headers as Record<string, string>)['user-agent']).toContain('LocalEvents/1.0');
      return Response.json([{ lat: '61.303', lon: '17.059' }]);
    });
    expect(point).toEqual({ lat: 61.303, lng: 17.059 });
    expect(urls.some((url) => url.includes('nominatim.openstreetmap.org'))).toBe(true);
    expect(urls.filter((url) => url.includes('photon.komoot.io'))).toHaveLength(1);
  });
});

describe('cityFromPoint', () => {
  it('reads the city from Nominatim when Photon does not answer', async () => {
    const urls: string[] = [];
    const city = await cityFromPoint({ lat: 61.7265, lng: 17.1056 }, async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('photon.komoot.io')) throw new Error('connect ECONNREFUSED');
      return Response.json({ address: { city: 'Hudiksvall', country_code: 'se' } });
    });
    expect(city).toBe('Hudiksvall');
    expect(urls.some((url) => url.includes('/reverse'))).toBe(true);
  });
});
