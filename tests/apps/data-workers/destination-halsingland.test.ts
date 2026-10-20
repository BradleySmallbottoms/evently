import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { persistSource } from '../../../apps/data-workers/src/persist';
import { IncomingEvent, type SourceRunContext } from '../../../packages/ingest/src/index';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../apps/data-workers/src/http1', () => ({
  HTTP1_HEADER: 'x-local-events-http1',
  http1Fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
}));
import fixture from '../../../apps/data-workers/src/sources/destination-halsingland/fixture.json' with { type: 'json' };
import {
  destinationHalsingland,
  pointFromCoordinates,
  type HalsinglandProduct,
  type HalsinglandRaw,
} from '../../../apps/data-workers/src/sources/destination-halsingland';

const raw = fixture as HalsinglandRaw;

function ctx(
  fetchImpl: SourceRunContext['fetch'],
  config: Record<string, unknown> = {},
): SourceRunContext {
  return {
    sourceSlug: 'destination-halsingland',
    config: { delayMs: 0, ...config },
    fetch: fetchImpl,
    log: () => undefined,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const listItem = {
  id: 'todo-2826465',
  name: 'Billy Opel - Kulturhuset Bollnäs',
  url: 'https://visit.destinationhalsingland.se/sv/se-gora/2826465/billy-opel-kulturhuset-bollnas/detaljer?filter=c%3D4559',
  location: 'Bollnäs',
  coordinates: [16.3952167, 61.3505711],
  introduction: '14 november | Billy tar oss med på en resa.',
  images: [{ url: 'https://images.citybreakcdn.com/image.aspx?ImageId=15326619' }],
  attributes: [{ name: 'Åldersgräns 18', iconClassName: '' }],
  pricing: { priceAndCurrency: '' },
};

const content = {
  title: 'Billy Opel - Kulturhuset Bollnäs',
  location: 'Bollnäs',
  introduction: '14 november | Billy tar oss med på en resa.',
  description: 'Biljetter på <a href="https://www.tickster.com/se/billy">Tickster</a>.',
  goodToKnow: [
    {
      name: 'Evenemangslänk',
      attributes: [
        {
          name: '<a href="https://kulturhuset.example/billy">kulturhuset.example/billy</a>',
        },
      ],
    },
  ],
  images: [{ url: 'https://images.citybreakcdn.com/image.aspx?ImageId=15326619' }],
};

const booking = {
  price: { priceAndCurrency: '200 SEK' },
  externalBookingUrl: null,
  occasions: [{ date: '2026-11-14', period: '19:00 - 20:30', arena: 'Kulturhuset Bollnäs' }],
};

describe('destination-halsingland map', () => {
  const [event] = destinationHalsingland.map(raw);

  it('emits a Stockholm time and the list coordinate', () => {
    expect(IncomingEvent.safeParse(event).success).toBe(true);
    expect(event?.externalId).toBe('2826465:2026-11-14T19:00:00:2026-11-14T20:30:00');
    expect(event?.startsAt).toBe('2026-11-14T19:00:00+01:00');
    expect(event?.endsAt).toBe('2026-11-14T20:30:00+01:00');
    expect(event?.priceAmount).toBe(20_000);
    expect(event?.currency).toBe('SEK');
    expect(event?.venueName).toBe('Kulturhuset Bollnäs');
    expect(event?.address).toBe('Bollnäs');
    expect(event?.location).toEqual({ lat: 61.3505711, lng: 16.3952167 });
    expect(event?.sourceUrl).toBe(
      'https://visit.destinationhalsingland.se/sv/se-gora/2826465/billy-opel-kulturhuset-bollnas/detaljer',
    );
  });

  it('reads longitude first and swaps a latitude-first pair', () => {
    expect(pointFromCoordinates([16.3952167, 61.3505711])).toEqual({
      lat: 61.3505711,
      lng: 16.3952167,
    });
    expect(pointFromCoordinates([61.3505711, 16.3952167])).toEqual({
      lat: 61.3505711,
      lng: 16.3952167,
    });
    expect(pointFromCoordinates(null)).toBeUndefined();
  });

  it('collapses a long daily exhibition into one span', () => {
    const occasions: HalsinglandProduct['occasions'] = [];
    for (let day = 0; day < 40; day += 1) {
      const date = new Date(Date.UTC(2026, 10, 13 + day));
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const dateNumber = String(date.getUTCDate()).padStart(2, '0');
      occasions.push({
        date: `${date.getUTCFullYear()}-${month}-${dateNumber}`,
        start: '10:00',
        end: '18:00',
        venue: 'Mobackes Trädgårdscenter, Bollnäs',
      });
    }
    const product: HalsinglandProduct = {
      ...raw.products[0]!,
      id: '1960936',
      title: 'Amaryllisutställningen på Mobackes 2026',
      freeEntry: true,
      priceText: undefined,
      organizerKeys: ['mobackes.se'],
      organizerName: 'Mobackes Trädgårdscenter',
      occasions,
    };
    const [span] = destinationHalsingland.map({ ...raw, products: [product] });
    expect(span?.externalId).toBe('1960936:span');
    expect(span?.startsAt).toBe('2026-11-13T10:00:00+01:00');
    expect(span?.endsAt).toBe('2026-12-22T18:00:00+01:00');
    expect(span?.priceAmount).toBe(0);
    expect(span?.meta?.freeEntry).toBe(true);
    expect(span?.meta?.collapsed).toBe(true);
    expect(span?.meta?.occasions).toHaveLength(40);
    expect(span?.meta?.occasions?.[0]).toEqual({
      startsAt: '2026-11-13T10:00:00+01:00',
      endsAt: '2026-11-13T18:00:00+01:00',
      venueName: 'Mobackes Trädgårdscenter, Bollnäs',
    });
    expect(span?.meta?.occasions?.at(-1)?.endsAt).toBe('2026-12-22T18:00:00+01:00');
    expect(span?.venueName).toBe('Mobackes Trädgårdscenter, Bollnäs');
  });

  it('stamps the product id when two occasions stay separate', () => {
    const product: HalsinglandProduct = {
      ...raw.products[0]!,
      occasions: [
        { date: '2026-11-14', start: '19:00', end: '20:30', venue: 'Kulturhuset Bollnäs' },
        { date: '2026-12-12', start: '19:00', end: '20:30', venue: 'Kulturhuset Bollnäs' },
      ],
    };
    const events = destinationHalsingland.map({ ...raw, products: [product] });
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.meta?.occasionGroupId)).toEqual(['2826465', '2826465']);
  });

  it('rolls an end after midnight onto the next day', () => {
    const product: HalsinglandProduct = {
      ...raw.products[0]!,
      occasions: [
        { date: '2026-11-14', start: '22:00', end: '00:30', venue: 'Kulturhuset Bollnäs' },
      ],
    };
    const [event] = destinationHalsingland.map({ ...raw, products: [product] });
    expect(event?.startsAt).toBe('2026-11-14T22:00:00+01:00');
    expect(event?.endsAt).toBe('2026-11-15T00:30:00+01:00');
  });
});

describe('destination-halsingland fetch', () => {
  it('loads the event list and then each product JSON', async () => {
    const calls: string[] = [];
    const agents: string[] = [];
    const fetched = await destinationHalsingland.fetchRaw(
      ctx(async (input, init) => {
        const url = String(input);
        calls.push(url);
        const headers = new Headers(init?.headers);
        agents.push(headers.get('user-agent') ?? '');
        if (headers.get('x-local-events-http1') !== '1') {
          throw new Error('calendar request was not marked for HTTP/1.1');
        }
        if (url.includes('/se-och-gora/products')) {
          const page = new URL(url).searchParams.get('page');
          if (page === '1') return json({ page: 1, totalResults: 1, items: [listItem] });
          return json({ page: 2, totalResults: 1, items: [] });
        }
        if (url.includes('/product/productcontent')) return json(content);
        if (url.includes('/todobookingcontrolcontext')) return json(booking);
        return json({}, 404);
      }),
    );
    expect(calls[0]).toBe(
      'https://visit.destinationhalsingland.se/sv/se-och-gora/products?page=1&pageSize=10&filter=c%3D4559&sorting=st%3Da%3Bso%3Da%3Bsplit%3Dhl',
    );
    expect(agents.every((agent) => agent === 'PostmanRuntime/2.11.0')).toBe(true);
    expect(calls.some((url) => url.includes('/product/productcontent?cbisProductId=2826465'))).toBe(
      true,
    );
    expect(
      calls.some((url) => url.includes('/todobookingcontrolcontext?cbisProductId=2826465')),
    ).toBe(true);
    expect(fetched.products).toHaveLength(1);
    const [event] = destinationHalsingland.map(fetched);
    expect(event?.priceAmount).toBe(20_000);
    expect(event?.meta).toEqual({
      ageLimit: 18,
      address: {
        city: 'Bollnäs',
        country: 'Sweden',
        location: { lat: 61.3505711, lng: 16.3952167 },
      },
    });
    expect(event?.organizerKeys).toEqual([
      'kulturhuset.example/billy',
      'kulturhuset.example',
      'kulturhuset bollnäs',
    ]);
    expect(event?.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tickets',
          url: 'https://www.tickster.com/se/billy',
        }),
        expect.objectContaining({
          type: 'info',
          url: 'https://kulturhuset.example/billy',
        }),
      ]),
    );
    expect(event?.location).toEqual({ lat: 61.3505711, lng: 16.3952167 });
  });

  it('keeps an off-host page and adds the named product links once', async () => {
    const page = 'https://event.paloma.se/Event/foretagarfrukost/';
    const fetched = await destinationHalsingland.fetchRaw(
      ctx(async (input) => {
        const url = String(input);
        if (url.includes('/se-och-gora/products')) {
          const pageNumber = new URL(url).searchParams.get('page');
          if (pageNumber === '1') {
            return json({ totalResults: 1, items: [{ ...listItem, url: page }] });
          }
          return json({ totalResults: 1, items: [] });
        }
        if (url.includes('/product/productcontent')) {
          return json({
            ...content,
            description: `Anmälan: ${page}`,
            goodToKnow: [
              {
                name: 'Webbsida',
                attributes: [
                  { name: '<a href="http://www.gladahudik.se">http://www.gladahudik.se</a>' },
                ],
              },
              {
                name: 'Evenemangslänk',
                attributes: [{ name: `<a href="${page}">${page}</a>` }],
              },
              {
                name: 'Externa länkar',
                attributes: [
                  {
                    name: '<a href="https://www.gladahudik.se/sv/foretagarveckan">https://www.gladahudik.se/sv/foretagarveckan</a>',
                  },
                ],
              },
            ],
          });
        }
        return json(booking);
      }),
    );
    const [event] = destinationHalsingland.map(fetched);
    expect(event?.sourceUrl).toBe(page);
    const eventPages = event?.links?.filter(
      (link) => link.url === 'https://event.paloma.se/Event/foretagarfrukost',
    );
    expect(eventPages).toEqual([
      {
        type: 'info',
        url: 'https://event.paloma.se/Event/foretagarfrukost',
        label: 'Evenemangslänk',
      },
    ]);
    expect(event?.links).toEqual(
      expect.arrayContaining([
        { type: 'info', url: 'http://www.gladahudik.se/', label: 'Webbsida' },
        {
          type: 'info',
          url: 'https://www.gladahudik.se/sv/foretagarveckan',
          label: 'Externa länkar',
        },
      ]),
    );
  });

  it('uses the postadress city when the product has no venue', async () => {
    async function load(postadress: string, arena?: string) {
      const fetched = await destinationHalsingland.fetchRaw(
        ctx(async (input) => {
          const url = String(input);
          if (url.includes('/se-och-gora/products')) {
            const page = new URL(url).searchParams.get('page');
            if (page === '1') return json({ totalResults: 1, items: [listItem] });
            return json({ totalResults: 1, items: [] });
          }
          if (url.includes('/product/productcontent')) {
            return json({
              ...content,
              location: 'Hudiksvall',
              goodToKnow: [{ name: 'Postadress', attributes: [{ name: postadress }] }],
            });
          }
          return json({
            occasions: arena ? [{ date: '2026-11-14', period: '19:00 - 20:30', arena }] : [],
          });
        }),
      );
      return destinationHalsingland.map(fetched)[0];
    }
    const fromPostcode = await load('82471 Delsbo');
    expect(fromPostcode?.venueName).toBe('Delsbo');
    expect(fromPostcode?.address).toBe('Hudiksvall');
    expect(fromPostcode?.location).toEqual({ lat: 61.3505711, lng: 16.3952167 });
    expect(fromPostcode?.meta?.address).toEqual({
      zipCode: '82471',
      city: 'Delsbo',
      country: 'Sweden',
      location: { lat: 61.3505711, lng: 16.3952167 },
    });
    const spaced = await load('824 71 Iggesund');
    expect(spaced?.venueName).toBe('Iggesund');
    const sixDigits = await load('123456 Järvsö');
    expect(sixDigits?.venueName).toBe('Järvsö');
    const named = await load('82471 Delsbo', 'Svea Bio');
    expect(named?.venueName).toBe('Svea Bio');
    const fallback = await load('Köpmangatan 14');
    expect(fallback?.venueName).toBeUndefined();
    expect(fallback?.address).toBe('Hudiksvall');
    expect(fallback?.location).toEqual({ lat: 61.3505711, lng: 16.3952167 });
  });

  it('treats a free-admission label as free and leaves parking text alone', async () => {
    async function load(attribute: string) {
      return destinationHalsingland.fetchRaw(
        ctx(async (input) => {
          const url = String(input);
          if (url.includes('/se-och-gora/products')) {
            const page = new URL(url).searchParams.get('page');
            if (page === '1') return json({ totalResults: 1, items: [listItem] });
            return json({ totalResults: 1, items: [] });
          }
          if (url.includes('/product/productcontent')) {
            return json({
              ...content,
              goodToKnow: [{ name: 'Prisinformation', attributes: [{ name: attribute }] }],
            });
          }
          return json({ ...booking, price: { priceAndCurrency: '' } });
        }),
      );
    }
    const [free] = destinationHalsingland.map(await load('Fritt inträde'));
    expect(free?.priceAmount).toBe(0);
    expect(free?.meta).toMatchObject({ freeEntry: true, ageLimit: 18 });
    const [parking] = destinationHalsingland.map(await load('Gratis parkering'));
    expect(parking?.priceAmount).toBeUndefined();
    expect(parking?.meta).toEqual({
      ageLimit: 18,
      address: {
        city: 'Bollnäs',
        country: 'Sweden',
        location: { lat: 61.3505711, lng: 16.3952167 },
      },
    });
  });

  it('keeps an event that has occasions but no coordinate', async () => {
    const fetched = await destinationHalsingland.fetchRaw(
      ctx(async (input) => {
        const url = String(input);
        if (url.includes('/se-och-gora/products')) {
          const page = new URL(url).searchParams.get('page');
          if (page === '1') {
            return json({
              totalResults: 1,
              items: [{ ...listItem, id: 'todo-2902955', coordinates: null, location: null }],
            });
          }
          return json({ totalResults: 1, items: [] });
        }
        if (url.includes('/product/productcontent')) {
          return json({ ...content, title: 'Bubbelprovning', location: null, goodToKnow: [] });
        }
        return json({
          occasions: [
            { date: '2026-10-31', period: '15:00 - 18:00', arena: 'Mellanfjärdens Deli' },
          ],
        });
      }),
    );
    const [event] = destinationHalsingland.map(fetched);
    expect(event?.location).toBeUndefined();
    expect(event?.startsAt).toBe('2026-10-31T15:00:00+01:00');
    expect(event?.venueName).toBe('Mellanfjärdens Deli');
  });

  it('keeps a product that has no occasions and leaves the dates empty', async () => {
    const fetched = await destinationHalsingland.fetchRaw(
      ctx(async (input) => {
        const url = String(input);
        if (url.includes('/se-och-gora/products')) {
          const page = new URL(url).searchParams.get('page');
          if (page === '1') {
            return json({
              totalResults: 1,
              items: [{ ...listItem, id: 'todo-2900492', name: 'Utställning' }],
            });
          }
          return json({ totalResults: 1, items: [] });
        }
        if (url.includes('/product/productcontent')) {
          return json({ ...content, title: 'Utställning utan tider', goodToKnow: [] });
        }
        return json({ occasions: [] });
      }),
    );
    const [mapped] = destinationHalsingland.map(fetched);
    expect(mapped?.externalId).toBe('2900492');
    expect(mapped?.title).toBe('Utställning utan tider');
    expect(mapped?.startsAt).toBeUndefined();
    expect(mapped?.endsAt).toBeUndefined();
    expect(IncomingEvent.safeParse(mapped).success).toBe(true);
  });

  it('saves each event before fetching the next product', async () => {
    const store = createMemoryIngestStore();
    store.sources.push({
      id: '55555555-5555-4555-8555-555555555501',
      slug: 'destination-halsingland',
      trust: 'review',
      config: { delayMs: 0 },
      enabled: true,
    });
    let savedBeforeSecond = -1;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cbisProductId=2') && savedBeforeSecond < 0) {
        savedBeforeSecond = store.events.length;
      }
      if (url.includes('/se-och-gora/products')) {
        const page = new URL(url).searchParams.get('page');
        if (page === '1') {
          return json({
            totalResults: 2,
            items: [
              { ...listItem, id: 'todo-1', name: 'One' },
              {
                ...listItem,
                id: 'todo-2',
                name: 'Two',
                url: 'https://visit.destinationhalsingland.se/sv/se-gora/2/two/detaljer',
              },
            ],
          });
        }
        return json({ totalResults: 2, items: [] });
      }
      const id = new URL(url).searchParams.get('cbisProductId');
      if (url.includes('/product/productcontent')) {
        return json({ ...content, title: id === '2' ? 'Two' : 'One', goodToKnow: [] });
      }
      return json({
        occasions: [
          {
            date: id === '2' ? '2026-11-15' : '2026-11-14',
            period: '19:00 - 20:30',
            arena: 'Kulturhuset Bollnäs',
          },
        ],
      });
    });
    try {
      const summary = await persistSource(store, 'destination-halsingland');
      expect(savedBeforeSecond).toBe(1);
      expect(summary.fetched).toBe(2);
      expect(summary.created + summary.skipped).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses an origin outside the calendar host', async () => {
    await expect(
      destinationHalsingland.fetchRaw(ctx(async () => json({}), { origin: 'https://example.com' })),
    ).rejects.toThrow(/visit\.destinationhalsingland\.se/);
  });
});
