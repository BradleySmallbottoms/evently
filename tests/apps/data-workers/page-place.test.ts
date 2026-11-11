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
  it('keeps a Swedish hit with the same house number', async () => {
    const point = await geocodeSwedishAddress(
      { address: 'Köpmangatan 14', zipCode: '82471', city: 'Delsbo' },
      async () =>
        Response.json({
          features: [
            {
              geometry: { coordinates: [10, 59] },
              properties: { countrycode: 'NO', housenumber: '14' },
            },
            {
              geometry: { coordinates: [16.55, 61.8] },
              properties: {
                countrycode: 'SE',
                housenumber: '14',
                street: 'Köpmangatan',
                city: 'Delsbo',
              },
            },
          ],
        }),
      { googleKey: '' },
    );
    expect(point).toEqual({ lat: 61.8, lng: 16.55 });
  });

  it('rejects a different house number and uses a Google rooftop', async () => {
    const hosts: string[] = [];
    const point = await geocodeSwedishAddress(
      { address: 'Hotellgatan 12', city: 'Ljusdal' },
      async (input) => {
        const url = new URL(String(input));
        hosts.push(url.hostname);
        if (url.hostname === 'photon.komoot.io') {
          return Response.json({
            features: [
              {
                geometry: { coordinates: [16.0987504, 61.8279612] },
                properties: {
                  countrycode: 'SE',
                  housenumber: '22A',
                  street: 'Hotellgatan',
                  city: 'Ljusdal',
                },
              },
            ],
          });
        }
        return Response.json({
          results: [
            {
              address_components: [
                { long_name: '12', types: ['street_number'] },
                { long_name: 'Hotellgatan', types: ['route'] },
                { long_name: 'Ljusdal', types: ['locality'] },
                { long_name: 'Sweden', short_name: 'SE', types: ['country'] },
              ],
              geometry: {
                location: { lat: 61.829, lng: 16.091 },
                location_type: 'ROOFTOP',
              },
            },
          ],
        });
      },
      { googleKey: 'test-key' },
    );
    expect(hosts).toEqual(['maps.googleapis.com']);
    expect(point).toEqual({ lat: 61.829, lng: 16.091 });
  });

  it('uses a street with no house number before the town', async () => {
    const queries: string[] = [];
    const point = await geocodeSwedishAddress(
      { address: 'Museivägen 1', city: 'Ljusdal' },
      async (input) => {
        const url = new URL(String(input));
        queries.push(url.searchParams.get('q') ?? '');
        return Response.json({
          features: [
            {
              geometry: { coordinates: [16.09, 61.829] },
              properties: {
                countrycode: 'SE',
                name: 'Svenska Röda Korset',
                street: 'Museivägen',
                city: 'Ljusdal',
                type: 'house',
              },
            },
            {
              geometry: { coordinates: [16.0780721, 61.8288075] },
              properties: {
                countrycode: 'SE',
                name: 'Museivägen',
                city: 'Ljusdal',
                type: 'street',
              },
            },
            {
              geometry: { coordinates: [12.1538583, 58.0362644] },
              properties: {
                countrycode: 'SE',
                housenumber: '1',
                street: 'Museivägen',
                city: 'Lödöse',
                type: 'house',
              },
            },
          ],
        });
      },
      { googleKey: '' },
    );
    expect(point).toEqual({ lat: 61.8288075, lng: 16.0780721 });
    expect(queries).toEqual(['Museivägen 1, Ljusdal, Sweden']);
  });

  it('prefers a Google rooftop over a street that has no house number', async () => {
    const point = await geocodeSwedishAddress(
      { address: 'Museivägen 1', city: 'Ljusdal' },
      async (input) => {
        const url = new URL(String(input));
        if (url.hostname === 'photon.komoot.io') {
          return Response.json({
            features: [
              {
                geometry: { coordinates: [16.0780721, 61.8288075] },
                properties: {
                  countrycode: 'SE',
                  name: 'Museivägen',
                  city: 'Ljusdal',
                  type: 'street',
                },
              },
            ],
          });
        }
        return Response.json({
          results: [
            {
              address_components: [
                { long_name: '1', types: ['street_number'] },
                { long_name: 'Museivägen', types: ['route'] },
                { long_name: 'Ljusdal', types: ['locality'] },
                { long_name: 'Sweden', short_name: 'SE', types: ['country'] },
              ],
              geometry: {
                location: { lat: 61.8289, lng: 16.076 },
                location_type: 'ROOFTOP',
              },
            },
          ],
        });
      },
      { googleKey: 'test-key' },
    );
    expect(point).toEqual({ lat: 61.8289, lng: 16.076 });
  });

  it('prefers the named street over the same house number on another street', async () => {
    const queries: string[] = [];
    const point = await geocodeSwedishAddress(
      { address: 'Museivägen 1', city: 'Ljusdal' },
      async (input) => {
        queries.push(new URL(String(input)).searchParams.get('q') ?? '');
        return Response.json({
          features: [
            {
              geometry: { coordinates: [16.2, 61.9] },
              properties: {
                countrycode: 'SE',
                housenumber: '1',
                street: 'Storgatan',
                city: 'Ljusdal',
                type: 'house',
              },
            },
            {
              geometry: { coordinates: [16.0780721, 61.8288075] },
              properties: {
                countrycode: 'SE',
                name: 'Museivägen',
                city: 'Ljusdal',
                type: 'street',
              },
            },
          ],
        });
      },
      { googleKey: '' },
    );
    expect(point).toEqual({ lat: 61.8288075, lng: 16.0780721 });
    expect(queries).toEqual(['Museivägen 1, Ljusdal, Sweden']);
  });

  it('uses a Google street when the house number is missing', async () => {
    const queries: string[] = [];
    const point = await geocodeSwedishAddress(
      { address: 'Museivägen 1', city: 'Ljusdal' },
      async (input) => {
        const url = new URL(String(input));
        queries.push(url.hostname);
        if (url.hostname === 'photon.komoot.io') return Response.json({ features: [] });
        return Response.json({
          results: [
            {
              address_components: [
                { long_name: 'Ljusdal', types: ['locality'] },
                { long_name: 'Sweden', short_name: 'SE', types: ['country'] },
              ],
              geometry: {
                location: { lat: 61.8293755, lng: 16.0953598 },
                location_type: 'APPROXIMATE',
              },
            },
            {
              address_components: [
                { long_name: 'Museivägen', types: ['route'] },
                { long_name: 'Ljusdal', types: ['locality'] },
                { long_name: 'Sweden', short_name: 'SE', types: ['country'] },
              ],
              geometry: {
                location: { lat: 61.8288075, lng: 16.0780721 },
                location_type: 'GEOMETRIC_CENTER',
              },
            },
          ],
        });
      },
      { googleKey: 'test-key' },
    );
    expect(point).toEqual({ lat: 61.8288075, lng: 16.0780721 });
    expect(queries).toEqual(['maps.googleapis.com', 'photon.komoot.io']);
  });

  it('keeps a precise Google place in the town when the name is not a street', async () => {
    const hosts: string[] = [];
    const point = await geocodeSwedishAddress(
      { address: 'Sågtäkten 354', city: 'Strömsbruk' },
      async (input) => {
        hosts.push(new URL(String(input)).hostname);
        return Response.json({
          results: [
            {
              formatted_address: 'Sågtäkten 354, 824 95 Strömsbruk, Sverige',
              types: ['premise', 'street_address'],
              address_components: [
                { long_name: 'Sågtäkten', types: ['locality'] },
                { long_name: 'Strömsbruk', types: ['postal_town'] },
                { long_name: 'Sweden', short_name: 'SE', types: ['country'] },
              ],
              geometry: {
                location: { lat: 61.854352, lng: 17.3049707 },
                location_type: 'ROOFTOP',
              },
            },
          ],
        });
      },
      { googleKey: 'test-key' },
    );
    expect(point).toEqual({ lat: 61.854352, lng: 17.3049707 });
    expect(hosts).toEqual(['maps.googleapis.com']);
  });

  it('keeps Gamla Sibov 65 when Google calls the road Gamla Sibovägen', async () => {
    const lines: string[] = [];
    const point = await geocodeSwedishAddress(
      { address: 'Gamla Sibov 65', city: 'Kilafors' },
      async () =>
        Response.json({
          status: 'OK',
          results: [
            {
              formatted_address: 'Gamla Sibovägen 65, 823 91 Kilafors, Sverige',
              types: ['route'],
              address_components: [
                { long_name: '65', types: ['street_number'] },
                { long_name: 'Gamla Sibovägen', types: ['route'] },
                { long_name: 'Kilafors', types: ['postal_town'] },
                { long_name: 'Sweden', short_name: 'SE', types: ['country'] },
              ],
              geometry: {
                location: { lat: 61.214857, lng: 16.617462 },
                location_type: 'ROOFTOP',
              },
            },
          ],
        }),
      { googleKey: 'test-key', log: (line) => lines.push(line) },
    );
    expect(point).toEqual({ lat: 61.214857, lng: 16.617462 });
    expect(lines.some((line) => line.includes('no precise place'))).toBe(false);
    expect(lines.some((line) => line.includes('61.214857, 16.617462'))).toBe(true);
  });

  it('keeps a Google place whose road name is nearly the same', async () => {
    const lines: string[] = [];
    const point = await geocodeSwedishAddress(
      { address: 'Södra Näsberg 13', city: 'Korskrogen' },
      async () =>
        Response.json({
          status: 'OK',
          results: [
            {
              formatted_address: 'Södra Näsbergsvägen 13, 827 72 Korskrogen, Sverige',
              types: ['route'],
              address_components: [
                { long_name: '13', types: ['street_number'] },
                { long_name: 'Södra Näsbergsvägen', types: ['route'] },
                { long_name: 'Korskrogen', types: ['postal_town'] },
                { long_name: 'Sweden', short_name: 'SE', types: ['country'] },
              ],
              geometry: {
                location: { lat: 61.792628, lng: 15.6556297 },
                location_type: 'ROOFTOP',
              },
            },
          ],
        }),
      { googleKey: 'test-key', log: (line) => lines.push(line) },
    );
    expect(point).toEqual({ lat: 61.792628, lng: 15.6556297 });
    expect(lines.some((line) => line.includes('Södra Näsbergsvägen 13'))).toBe(true);
    expect(lines.some((line) => line.includes('similar Google place'))).toBe(true);
  });

  it('rejects a similar road when the house number differs', async () => {
    const point = await geocodeSwedishAddress(
      { address: 'Södra Näsberg 13', city: 'Korskrogen' },
      async (input) => {
        const address = new URL(String(input)).searchParams.get('address') ?? '';
        if (address.startsWith('Korskrogen')) {
          return Response.json({
            status: 'OK',
            results: [
              {
                formatted_address: '827 72 Korskrogen, Sverige',
                address_components: [
                  { long_name: 'Korskrogen', types: ['postal_town'] },
                  { long_name: 'Sweden', short_name: 'SE', types: ['country'] },
                ],
                geometry: {
                  location: { lat: 61.8102263, lng: 15.7586417 },
                  location_type: 'APPROXIMATE',
                },
              },
            ],
          });
        }
        return Response.json({
          status: 'OK',
          results: [
            {
              formatted_address: 'Södra Näsbergsvägen 15, 827 72 Korskrogen, Sverige',
              types: ['route'],
              address_components: [
                { long_name: '15', types: ['street_number'] },
                { long_name: 'Södra Näsbergsvägen', types: ['route'] },
                { long_name: 'Korskrogen', types: ['postal_town'] },
                { long_name: 'Sweden', short_name: 'SE', types: ['country'] },
              ],
              geometry: {
                location: { lat: 61.792, lng: 15.655 },
                location_type: 'ROOFTOP',
              },
            },
          ],
        });
      },
      { googleKey: 'test-key' },
    );
    expect(point).toEqual({ lat: 61.8102263, lng: 15.7586417 });
  });

  it('treats a street suffix as the same name', async () => {
    const point = await geocodeSwedishAddress(
      { address: 'Hotellgatan 12', city: 'Ljusdal' },
      async () =>
        Response.json({
          status: 'OK',
          results: [
            {
              formatted_address: 'Hotellgata 12, 827 30 Ljusdal, Sverige',
              address_components: [
                { long_name: '12', types: ['street_number'] },
                { long_name: 'Hotellgata', types: ['route'] },
                { long_name: 'Ljusdal', types: ['locality'] },
                { long_name: 'Sweden', short_name: 'SE', types: ['country'] },
              ],
              geometry: {
                location: { lat: 61.829, lng: 16.091 },
                location_type: 'ROOFTOP',
              },
            },
          ],
        }),
      { googleKey: 'test-key' },
    );
    expect(point).toEqual({ lat: 61.829, lng: 16.091 });
  });

  it('geocodes a city when nothing more specific exists or the street lookup misses', async () => {
    const calls: string[] = [];
    const onlyCity = await geocodeSwedishAddress(
      { city: 'Järvsö' },
      async (input) => {
        calls.push(new URL(String(input)).searchParams.get('q') ?? '');
        return Response.json({
          features: [
            { geometry: { coordinates: [16.17, 61.72] }, properties: { countrycode: 'SE' } },
          ],
        });
      },
      { googleKey: '' },
    );
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
            {
              geometry: { coordinates: [16.55, 61.8] },
              properties: { countrycode: 'SE', name: 'Delsbo', type: 'city' },
            },
          ],
        });
      },
      { googleKey: '' },
    );
    expect(fallbackCalls).toEqual(['Köpmangatan 14, Delsbo, Sweden', 'Delsbo, Sweden']);
    expect(fallback).toEqual({ lat: 61.8, lng: 16.55 });
  });

  it('asks Google for the town before Photon', async () => {
    const urls: string[] = [];
    const point = await geocodeSwedishAddress(
      { city: 'Söderhamn' },
      async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('photon.komoot.io')) throw new Error('connect ECONNREFUSED');
        return Response.json({
          results: [
            {
              address_components: [
                { long_name: 'Söderhamn', types: ['locality'] },
                { short_name: 'SE', types: ['country'] },
              ],
              geometry: { location: { lat: 61.303, lng: 17.059 }, location_type: 'APPROXIMATE' },
            },
          ],
        });
      },
      { googleKey: 'test-key' },
    );
    expect(point).toEqual({ lat: 61.303, lng: 17.059 });
    expect(urls.some((url) => url.includes('maps.googleapis.com'))).toBe(true);
    expect(urls.filter((url) => url.includes('photon.komoot.io'))).toHaveLength(0);
  });

  it('reuses a stored town and does not geocode it again', async () => {
    const calls: string[] = [];
    const cache = {
      async findCity() {
        return { lat: 61.83, lng: 16.09 };
      },
      async saveCity() {
        throw new Error('stored town should not be written again');
      },
    };
    const point = await geocodeSwedishAddress(
      { city: 'Ljusdal' },
      async (input) => {
        calls.push(String(input));
        return Response.json({ features: [] });
      },
      { googleKey: '', cache },
    );
    expect(point).toEqual({ lat: 61.83, lng: 16.09 });
    expect(calls).toEqual([]);
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
