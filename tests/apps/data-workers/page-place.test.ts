import { describe, expect, it } from 'vitest';
import { geocodeSwedishAddress, lookupPageUrl } from '../../../apps/data-workers/src/page-place';

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
});
