import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { IncomingEvent, type SourceRunContext } from '../../../packages/ingest/src/index';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { persistSource } from '../../../apps/data-workers/src/persist';
import {
  mapTicksterEvent,
  parseTicksterEvent,
  parseTicksterOrganizer,
  tickster,
  type TicksterEvent,
} from '../../../apps/data-workers/src/sources/tickster';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../apps/data-workers/src/sources/tickster/fixture.json', import.meta.url),
    'utf8',
  ),
) as unknown;

const organizerBody = {
  id: 'orghalsinge01',
  name: 'Hälsinge Konsert',
  website: 'https://halsingekonsert.example',
  email: 'hej@halsingekonsert.example',
  socialMedia: {
    facebook: 'https://www.facebook.com/halsingekonsert',
    instagram: 'https://www.instagram.com/halsingekonsert',
  },
};

function event(): TicksterEvent {
  const parsed = parseTicksterEvent(fixture);
  if (!parsed) throw new Error('fixture did not parse');
  return parsed;
}

function ctx(
  fetchImpl: SourceRunContext['fetch'],
  config: Record<string, unknown> = {},
  log: SourceRunContext['log'] = () => undefined,
): SourceRunContext {
  return {
    sourceSlug: 'tickster',
    config: { cities: ['Söderhamn'], ...config },
    fetch: fetchImpl,
    log,
  };
}

function jsonResponse(body: unknown, status = 200, url?: string, headers?: HeadersInit): Response {
  const response = Response.json(body, { status, headers });
  if (url) Object.defineProperty(response, 'url', { value: url });
  return response;
}

describe('tickster map', () => {
  it('keeps the UTC instant, the cheapest ticket, and the venue point', () => {
    const mapped = mapTicksterEvent({
      event: event(),
      organizer: parseTicksterOrganizer(organizerBody),
    });
    expect(IncomingEvent.safeParse(mapped).success).toBe(true);
    expect(mapped).toMatchObject({
      externalId: 'soderhamnconcert01',
      title: 'Hälsinge konsert',
      startsAt: '2026-11-14T17:00:00.000Z',
      endsAt: '2026-11-14T19:30:00.000Z',
      venueName: 'Kulturhuset Berget',
      address: 'Köpmangatan 1, Söderhamn',
      location: { lat: 61.306, lng: 17.06 },
      priceAmount: 20000,
      currency: 'SEK',
      mode: 'physical',
      tags: [],
      categoryHints: ['konsert', 'musik'],
      imageUrl: 'https://static.tickster.com/7b/108dec25ead1ac7b7bcb8e95a8951a68f9971e',
      sourceUrl: 'https://www.tickster.com/sv/events/soderhamnconcert01',
      organizerName: 'Hälsinge Konsert',
      meta: {
        ageLimit: 18,
        address: {
          address: 'Köpmangatan 1',
          zipCode: '82630',
          city: 'Söderhamn',
          country: 'Sweden',
          location: { lat: 61.306, lng: 17.06 },
        },
      },
    });
    expect(mapped.description).toContain('En kväll med musik');
    expect(mapped.meta?.freeEntry).toBeUndefined();
    expect(mapped.links).toEqual([
      {
        type: 'tickets',
        url: 'https://secure.tickster.com/soderhamnconcert01',
        label: 'Tickster',
      },
      { type: 'info', url: 'https://www.tickster.com/sv/events/soderhamnconcert01' },
      { type: 'info', url: 'https://halsingekonsert.example/', label: 'Hälsinge Konsert' },
      { type: 'facebook', url: 'https://www.facebook.com/halsingekonsert' },
      { type: 'instagram', url: 'https://www.instagram.com/halsingekonsert' },
      { type: 'info', url: 'https://example.com/band', label: 'Bandet' },
    ]);
    expect(mapped.organizerKeys.slice(0, 2)).toEqual([
      'orghalsinge01',
      'hej@halsingekonsert.example',
    ]);
    expect(mapped.organizerKeys).toContain('halsingekonsert.example');
    expect(mapped.organizerKeys).not.toContain('tickster');
  });

  it('stores a free ticket and reads a stated age from the description', () => {
    const showing = event();
    showing.products = [
      { productType: 'ticket', price: { amount: 0, currency: 'SEK' }, variants: [] },
    ];
    showing.ageLimit = undefined;
    showing.descriptionHtml = '<p>Åldersgräns: 15. Gratis inträde.</p>';
    const mapped = mapTicksterEvent({ event: showing });
    expect(mapped.priceAmount).toBe(0);
    expect(mapped.currency).toBe('SEK');
    expect(mapped.meta?.freeEntry).toBe(true);
    expect(mapped.meta?.ageLimit).toBe(15);
  });

  it('omits a 0,0 venue point and keeps the street', () => {
    const showing = event();
    showing.latitude = 0;
    showing.longitude = 0;
    const mapped = mapTicksterEvent({ event: showing });
    expect(mapped.location).toBeUndefined();
    expect(mapped.meta?.address).toEqual({
      address: 'Köpmangatan 1',
      zipCode: '82630',
      city: 'Söderhamn',
      country: 'Sweden',
    });
  });

  it('saves a showing with no clock and no point', () => {
    const showing = event();
    showing.startUtc = undefined;
    showing.endUtc = undefined;
    showing.latitude = undefined;
    showing.longitude = undefined;
    const mapped = mapTicksterEvent({ event: showing });
    expect(IncomingEvent.safeParse(mapped).success).toBe(true);
    expect(mapped.startsAt).toBeUndefined();
    expect(mapped.endsAt).toBeUndefined();
    expect(mapped.location).toBeUndefined();
    expect(mapped.meta?.address?.location).toBeUndefined();
  });
});

describe('tickster fetch', () => {
  const previous = process.env.TICKSTER_API_KEY;
  const fileUrl = 'http://event-api-dumps.s3-eu-west-1.amazonaws.com/sv/upcoming/test';

  function restoreKey(): void {
    if (previous === undefined) delete process.env.TICKSTER_API_KEY;
    else process.env.TICKSTER_API_KEY = previous;
  }

  function pointer(uri = fileUrl): unknown {
    return {
      id: 'sv-upcoming-test',
      created: '2026-11-12T03:22:49+00:00',
      eTag: 'abc',
      uri,
    };
  }

  function dump(): unknown {
    const child = {
      id: 'soderhamnnight01',
      name: 'Hälsinge konsert',
      start: '2026-11-21T19:00:00+01:00',
      end: '2026-11-21T21:00:00+01:00',
      eventState: 'ReleasedForSale',
      published: true,
      hierarchyType: 'production-child',
      productionParentId: 'halsingeproduction',
      infoUri: 'https://www.tickster.com/sv/events/soderhamnnight01',
      shopUri: 'https://secure.tickster.com/soderhamnnight01',
      goods: [],
      venue: {
        name: 'Kulturhuset Berget',
        address: 'Köpmangatan 1',
        zipCode: '826 30',
        city: 'Söderhamn',
        country: 'SE',
      },
    };
    return {
      count: 4,
      created: '2026-11-12T03:22:49+00:00',
      events: [
        child,
        {
          id: 'halsingeproduction',
          name: 'Hälsinge turné',
          hierarchyType: 'production',
          eventState: 'ReleasedForSale',
          published: true,
          description: '<p>Turné.</p>',
          goods: [{ type: 'ticket', price: { includingVat: '100', currency: 'SEK' } }],
          organizerId: 'orghalsinge01',
          childEvents: [
            child,
            { ...child, id: 'stockholmnight01', venue: { ...child.venue, city: 'Stockholm' } },
          ],
        },
        {
          id: 'soderhamnconcert01',
          name: 'Hälsinge konsert',
          start: '2026-11-14T17:00:00Z',
          end: '2026-11-14T19:30:00Z',
          eventState: 'ReleasedForSale',
          published: true,
          hierarchyType: 'event',
          description:
            '<p>En kväll med musik.</p><p><a href="https://example.com/band">Bandet</a></p>',
          imageUrl: 'https://static.tickster.com/7b/108dec25ead1ac7b7bcb8e95a8951a68f9971e',
          infoUri: 'https://www.tickster.com/sv/events/soderhamnconcert01',
          shopUri: 'https://secure.tickster.com/soderhamnconcert01',
          organizerId: 'orghalsinge01',
          venueId: 'venueberget01',
          tags: ['konsert', 'musik'],
          links: [],
          goods: [
            { type: 'seasonoffer', price: { includingVat: '10', currency: 'SEK' } },
            { type: 'ticket', price: { includingVat: '250', currency: 'SEK' } },
            { type: 'ticket', price: { includingVat: '200', currency: 'SEK' } },
          ],
        },
        {
          id: 'cancelled01',
          name: 'Inställt',
          eventState: 'Cancelled',
          published: true,
          hierarchyType: 'event',
          venueId: 'venueberget01',
        },
        {
          id: 'nocity01',
          name: 'Utan stad',
          eventState: 'ReleasedForSale',
          published: true,
          hierarchyType: 'event',
          venueId: 'venuenocity',
        },
      ],
      venues: [
        {
          id: 'venueberget01',
          name: 'Kulturhuset Berget',
          address: 'Köpmangatan 1',
          zipCode: '826 30',
          city: 'Söderhamn',
          country: 'SE',
          geo: { latitude: 61.306, longitude: 17.06 },
        },
        { id: 'venuenocity', name: 'Okänd', country: 'SE' },
      ],
      organizers: [
        {
          id: 'orghalsinge01',
          name: 'Hälsinge Konsert',
          infoUri: 'https://www.tickster.com/sv/events/by/orghalsinge01',
          social: {
            facebook: 'https://www.facebook.com/halsingekonsert',
            instagram: 'https://www.instagram.com/halsingekonsert',
          },
        },
      ],
    };
  }

  function dumpFetch(body: unknown = dump(), file = fileUrl): SourceRunContext['fetch'] {
    return async (input, init) => {
      const url = new URL(String(input));
      expect(init?.redirect).toBe('error');
      if (url.hostname === 'api.tickster.com') {
        expect(url.pathname).toBe('/sv/api/1.0/events/dump/upcoming');
        expect(url.searchParams.get('key')).toBe('test-key');
        expect(new Headers(init?.headers).get('x-api-key')).toBe('test-key');
        return jsonResponse(pointer(file));
      }
      expect(url.hostname).toBe(new URL(file).hostname);
      return jsonResponse(body);
    };
  }

  it('reads the dump, skips a parent, and saves each showing', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    const store = createMemoryIngestStore();
    store.sources.push({
      id: '33333333-3333-4333-8333-333333333307',
      slug: 'tickster',
      trust: 'review',
      config: { cities: ['Söderhamn'] },
      enabled: true,
    });
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requested.push(`${url.hostname}${url.pathname}`);
      return dumpFetch()(input, init);
    });
    try {
      const summary = await persistSource(store, 'tickster');
      expect(summary.created).toBe(2);
      expect(store.events.map((row) => row.status)).toEqual(['pending_scan', 'pending_scan']);
      expect(store.events.map((row) => row.refId)).toEqual([
        'soderhamnnight01',
        'soderhamnconcert01',
      ]);
      expect(store.events[0]?.priceAmount).toBe(10000);
      expect(store.events[0]?.startsAt?.toISOString()).toBe('2026-11-21T18:00:00.000Z');
      expect(store.events[1]?.priceAmount).toBe(20000);
      expect(store.events[1]?.location).toEqual({ lat: 61.306, lng: 17.06 });
      expect(requested).toEqual([
        'api.tickster.com/sv/api/1.0/events/dump/upcoming',
        'event-api-dumps.s3-eu-west-1.amazonaws.com/sv/upcoming/test',
      ]);
    } finally {
      vi.unstubAllGlobals();
      restoreKey();
    }
  });

  it('keeps organizer social links and ignores a season offer', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    try {
      const raw = await tickster.fetchRaw(ctx(dumpFetch()));
      const concert = raw.events.find((item) => item.event.id === 'soderhamnconcert01');
      if (!concert) throw new Error('missing concert');
      const mapped = mapTicksterEvent(concert);
      expect(mapped.priceAmount).toBe(20000);
      expect(mapped.organizerKeys[0]).toBe('orghalsinge01');
      expect(mapped.organizerKeys).not.toContain('tickster');
      expect(mapped.links).toEqual([
        {
          type: 'tickets',
          url: 'https://secure.tickster.com/soderhamnconcert01',
          label: 'Tickster',
        },
        { type: 'info', url: 'https://www.tickster.com/sv/events/soderhamnconcert01' },
        { type: 'facebook', url: 'https://www.facebook.com/halsingekonsert' },
        { type: 'instagram', url: 'https://www.instagram.com/halsingekonsert' },
        { type: 'info', url: 'https://example.com/band', label: 'Bandet' },
      ]);
      expect(raw.events.map((item) => item.event.id)).toEqual([
        'soderhamnnight01',
        'soderhamnconcert01',
      ]);
    } finally {
      restoreKey();
    }
  });

  it('reads a gzip dump body', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    try {
      const raw = await tickster.fetchRaw(
        ctx(async (input, init) => {
          const url = new URL(String(input));
          if (url.hostname === 'api.tickster.com') return jsonResponse(pointer());
          const bytes = gzipSync(Buffer.from(JSON.stringify(dump())));
          expect(init?.redirect).toBe('error');
          return new Response(bytes, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }),
      );
      expect(raw.events.map((item) => item.event.id)).toEqual([
        'soderhamnnight01',
        'soderhamnconcert01',
      ]);
    } finally {
      restoreKey();
    }
  });

  it('fails when the pointer leaves api.tickster.com', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    try {
      await expect(
        tickster.fetchRaw(
          ctx(async () => jsonResponse(pointer(), 200, 'https://evil.example/events')),
        ),
      ).rejects.toThrow(/api\.tickster\.com/);
    } finally {
      restoreKey();
    }
  });

  it('fails when the dump file is not on the dump bucket', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    let calls = 0;
    try {
      await expect(
        tickster.fetchRaw(
          ctx(async () => {
            calls += 1;
            return jsonResponse(pointer('https://evil.example/dump.json'));
          }),
        ),
      ).rejects.toThrow(/event dump bucket/);
      expect(calls).toBe(1);
    } finally {
      restoreKey();
    }
  });

  it('fails when the dump file leaves the dump bucket', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    try {
      await expect(
        tickster.fetchRaw(
          ctx(async (input) => {
            const url = new URL(String(input));
            if (url.hostname === 'api.tickster.com') return jsonResponse(pointer());
            return jsonResponse(dump(), 200, 'https://evil.example/file');
          }),
        ),
      ).rejects.toThrow(/event dump bucket/);
    } finally {
      restoreKey();
    }
  });

  it('refuses a city that is not a name', async () => {
    await expect(
      tickster.fetchRaw(ctx(async () => jsonResponse({}), { cities: ['https://evil.example'] })),
    ).rejects.toThrow(/city names/);
  });

  it('does not repeat the API key when the pointer request fails', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    try {
      await expect(
        tickster.fetchRaw(
          ctx(async () => {
            throw new Error(
              'connect failed for https://api.tickster.com/sv/api/1.0/events/dump/upcoming?key=test-key',
            );
          }),
        ),
      ).rejects.toThrow(/^tickster request failed$/);
    } finally {
      restoreKey();
    }
  });

  it('throws when the key is missing', async () => {
    delete process.env.TICKSTER_API_KEY;
    try {
      await expect(tickster.fetchRaw(ctx(async () => jsonResponse({ items: [] })))).rejects.toThrow(
        /TICKSTER_API_KEY/,
      );
    } finally {
      restoreKey();
    }
  });

  it('stops on a 403 when the test ingest asks it to', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    process.env.TICKSTER_STOP_ON_403 = '1';
    const logged: string[] = [];
    try {
      const raw = await tickster.fetchRaw(
        ctx(
          async () => jsonResponse({ error: 'Invalid or missing API-key' }, 403),
          {},
          (message) => logged.push(message),
        ),
      );
      expect(raw.events).toEqual([]);
      expect(logged.join(' ')).not.toContain('test-key');
    } finally {
      restoreKey();
      delete process.env.TICKSTER_STOP_ON_403;
    }
  });

  it('fails a 403 when the test ingest has not asked it to stop', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    try {
      await expect(
        tickster.fetchRaw(
          ctx(async () => jsonResponse({ error: 'Invalid or missing API-key' }, 403)),
        ),
      ).rejects.toThrow(/403/);
    } finally {
      restoreKey();
    }
  });

  it('uses the parent ticket when the showing only has a season offer', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    try {
      const raw = await tickster.fetchRaw(
        ctx(
          dumpFetch({
            events: [
              {
                id: 'parentoffer01',
                name: 'Turné',
                hierarchyType: 'production',
                eventState: 'ReleasedForSale',
                published: true,
                goods: [{ type: 'ticket', price: { includingVat: '180', currency: 'SEK' } }],
                childEvents: [
                  {
                    id: 'childoffer01',
                    name: 'Kväll',
                    hierarchyType: 'production-child',
                    eventState: 'ReleasedForSale',
                    published: true,
                    goods: [
                      { type: 'seasonoffer', price: { includingVat: '10', currency: 'SEK' } },
                    ],
                    venue: { name: 'Berget', city: 'Söderhamn', country: 'SE' },
                  },
                ],
              },
            ],
            venues: [],
            organizers: [],
          }),
        ),
      );
      expect(mapTicksterEvent(raw.events[0]!).priceAmount).toBe(18000);
    } finally {
      restoreKey();
    }
  });

  it('keeps a paid price region when another region is zero', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    try {
      const raw = await tickster.fetchRaw(
        ctx(
          dumpFetch({
            events: [
              {
                id: 'regions01',
                name: 'Numrerat',
                hierarchyType: 'event',
                eventState: 'ReleasedForSale',
                published: true,
                goods: [
                  {
                    type: 'ticket',
                    price: {
                      currency: 'SEK',
                      priceRegions: [{ includingVat: '0' }, { includingVat: '200' }],
                    },
                  },
                ],
                venue: { name: 'Berget', city: 'Söderhamn', country: 'SE' },
              },
            ],
            venues: [],
            organizers: [],
          }),
        ),
      );
      expect(mapTicksterEvent(raw.events[0]!).priceAmount).toBe(20000);
      expect(mapTicksterEvent(raw.events[0]!).meta?.freeEntry).toBeUndefined();
    } finally {
      restoreKey();
    }
  });

  it('fills a city and a point from the catalog when the nested venue has neither', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    try {
      const raw = await tickster.fetchRaw(
        ctx(
          dumpFetch({
            events: [
              {
                id: 'nestedvenue01',
                name: 'Konsert',
                hierarchyType: 'event',
                eventState: 'ReleasedForSale',
                published: true,
                venueId: 'venueberget01',
                venue: { id: 'venueberget01', name: 'Kulturhuset Berget' },
              },
            ],
            venues: [
              {
                id: 'venueberget01',
                name: 'Kulturhuset Berget',
                city: 'Söderhamn',
                country: 'SE',
                geo: { latitude: 61.306, longitude: 17.06 },
              },
            ],
            organizers: [],
          }),
        ),
      );
      const mapped = mapTicksterEvent(raw.events[0]!);
      expect(mapped.address).toBe('Söderhamn');
      expect(mapped.location).toEqual({ lat: 61.306, lng: 17.06 });
    } finally {
      restoreKey();
    }
  });

  it('rejects a dump host that only looks like the bucket', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    try {
      await expect(
        tickster.fetchRaw(
          ctx(async () =>
            jsonResponse(
              pointer('http://event-api-dumps.s3.attacker.s3.eu-north-1.amazonaws.com/dump.json'),
            ),
          ),
        ),
      ).rejects.toThrow(/event dump bucket/);
    } finally {
      restoreKey();
    }
  });

  it('throws when every hit is skipped', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    try {
      await expect(
        tickster.fetchRaw(
          ctx(
            dumpFetch({
              events: [
                {
                  id: 'cancelled01',
                  name: 'Inställt',
                  eventState: 'Cancelled',
                  published: true,
                  hierarchyType: 'event',
                  venue: { city: 'Söderhamn', country: 'SE' },
                },
              ],
              venues: [],
              organizers: [],
            }),
          ),
        ),
      ).rejects.toThrow(/no usable events/);
    } finally {
      restoreKey();
    }
  });
});
