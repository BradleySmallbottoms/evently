import { readFileSync } from 'node:fs';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { persistSource } from '../../../apps/data-workers/src/persist';
import {
  IncomingEvent,
  ollamaDisabled,
  type SourceRunContext,
} from '../../../packages/ingest/src/index';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../apps/data-workers/src/sources/glada-hudik/fixture.json' with { type: 'json' };
import {
  assignOccasionYears,
  gladaHudik,
  parseEventPage,
  parseListItem,
  type GladaProduct,
  type GladaRaw,
} from '../../../apps/data-workers/src/sources/glada-hudik';
import {
  createLocationLookupState,
  GLADA_HUDIK_DEFAULT_LOCATION,
  gladaLocationQueries,
  resolveGladaLocation,
} from '../../../apps/data-workers/src/sources/glada-hudik/location';
import {
  keptTagsForProduct,
  ollamaBaseUrl,
  parseTagChoices,
  tagCatalog,
} from '../../../apps/data-workers/src/sources/glada-hudik/match-tag';

const raw = fixture as GladaRaw;
const showHtml = readFileSync(
  new URL('../../../apps/data-workers/src/sources/glada-hudik/show.html', import.meta.url),
  'utf8',
);

/** The map div is split across lines, so a single-line match leaves the pin in place. */
function withoutMap(html: string): string {
  return html.replace(/<div\b[^>]*\bclass="sidebar-map\b[^>]*>\s*<\/div>/, '');
}

function ctx(
  fetchImpl: SourceRunContext['fetch'],
  config: Record<string, unknown> = {},
): SourceRunContext {
  return {
    sourceSlug: 'glada-hudik',
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

describe('glada-hudik page parse', () => {
  const product = parseEventPage(showHtml, 'cbis:2823720', '/sv/fredrik-andersson-too-soon');

  it('reads the show page into one priced occasion', () => {
    expect(product).toMatchObject({
      id: 'cbis:2823720',
      title: 'Fredrik Andersson - TOO SOON',
      intro: 'Ståuppshow med Fredrik Andersson',
      priceText: '450 SEK',
      organizerName: 'Skene Comedy',
      organizerEmail: 'info@skenecomedy.se',
      placeName: 'Kulturhuset Glada Hudik',
      address: 'Kulturhuset Glada Hudik, Storgatan 37, 824 52 Hudiksvall',
      city: 'Hudiksvall',
      imageUrl:
        'https://www.gladahudik.se/sites/cb_gladahudik/files/styles/slide_large/http/images.citybreak.com/14859640.jpeg.webp?itok=pvyz9-L6',
      location: { lat: 61.7279731, lng: 17.1077112 },
      occasions: [
        { day: 15, month: 10, start: '19:00', end: '20:20', venue: 'Kulturhuset Glada Hudik' },
      ],
    });
    expect(product?.links).toEqual([
      {
        type: 'info',
        url: 'https://www.fredrikanderssonproductions.com/',
        label: 'Evenemangslänk',
      },
      {
        type: 'tickets',
        url: 'https://www.tickster.com/se/sv/events/m39h6zg78kzcpyg/2026-10-15/fredrik-andersson-too-soon',
        label: 'Bokningslänk',
      },
      {
        type: 'info',
        url: 'https://www.facebook.com/events/123456789012345',
        label: 'Facebook',
      },
    ]);
  });

  it('reads the product id from a list card', () => {
    expect(
      parseListItem(
        '<a href="/sv/fredrik-andersson-too-soon" data-productid="cbis:2823720">Show</a>',
      ),
    ).toEqual({ id: 'cbis:2823720', path: '/sv/fredrik-andersson-too-soon' });
  });
});

describe('glada-hudik map', () => {
  const show = parseEventPage(showHtml, 'cbis:2823720', '/sv/fredrik-andersson-too-soon')!;
  const mapped = gladaHudik.map({ ...raw, products: [show, ...raw.products] });

  it('emits one event per product with Stockholm times and links', () => {
    const event = mapped[0]!;
    expect(IncomingEvent.safeParse(event).success).toBe(true);
    expect(event.externalId).toBe('cbis:2823720');
    expect(event.startsAt).toBe('2026-10-15T19:00:00+02:00');
    expect(event.endsAt).toBe('2026-10-15T20:20:00+02:00');
    expect(event.occasions?.[0]).toMatchObject({
      startsAt: '2026-10-15T19:00:00+02:00',
      endsAt: '2026-10-15T20:20:00+02:00',
    });
    expect(event.priceAmount).toBe(45_000);
    expect(event.currency).toBe('SEK');
    expect(event.venueName).toBe('Kulturhuset Glada Hudik');
    expect(event.location).toEqual({ lat: 61.7279731, lng: 17.1077112 });
    expect(event.meta?.address).toEqual({
      address: 'Kulturhuset Glada Hudik, Storgatan 37',
      zipCode: '82452',
      city: 'Hudiksvall',
      country: 'Sweden',
      location: { lat: 61.7279731, lng: 17.1077112 },
    });
    expect(event.organizerKeys).toEqual([
      'info@skenecomedy.se',
      'fredrikanderssonproductions.com',
      'skene comedy',
    ]);
    expect(event.sourceUrl).toBe('https://www.gladahudik.se/sv/fredrik-andersson-too-soon');
    expect(event.links?.[0]).toMatchObject({ type: 'info' });
    expect(event.links?.[1]).toMatchObject({ type: 'tickets' });
  });

  it('keeps a monthly book circle as one event with several occasions', () => {
    const circle = mapped.filter((event) => event.title.startsWith('Bokcirkel'));
    expect(circle).toHaveLength(1);
    expect(circle[0]?.occasions?.map((occasion) => occasion.startsAt)).toEqual([
      '2026-10-20T18:00:00+02:00',
      '2026-11-17T18:00:00+01:00',
      '2026-12-15T18:00:00+01:00',
    ]);
  });

  it('keeps a long daily exhibition as one event with many occasions', () => {
    const occasions: GladaProduct['occasions'] = [];
    for (let day = 0; day < 40; day += 1) {
      const date = new Date(Date.UTC(2026, 9, 12 + day));
      occasions.push({
        day: date.getUTCDate(),
        month: date.getUTCMonth() + 1,
        year: date.getUTCFullYear(),
        start: '10:00',
        end: '16:00',
        venue: 'Hälsingland Museum',
      });
    }
    const product: GladaProduct = {
      id: 'cbis:2866558',
      title: 'Blomstrande väggar',
      path: '/sv/blomstrande-vaggar',
      organizerName: 'Hälsingland Museum',
      links: [],
      occasions,
    };
    const [event] = gladaHudik.map({ ...raw, products: [product] });
    expect(event?.externalId).toBe('cbis:2866558');
    expect(event?.startsAt).toBe('2026-10-12T10:00:00+02:00');
    expect(event?.endsAt).toBe('2026-11-20T16:00:00+01:00');
    expect(event?.venueName).toBe('Hälsingland Museum');
    expect(event?.occasions).toHaveLength(40);
    expect(event?.occasions?.[0]).toMatchObject({
      startsAt: '2026-10-12T10:00:00+02:00',
      endsAt: '2026-10-12T16:00:00+02:00',
      venueName: 'Hälsingland Museum',
    });
    expect(event?.occasions?.at(-1)?.endsAt).toBe('2026-11-20T16:00:00+01:00');
    const kept = gladaHudik.map(
      { ...raw, products: [product] },
      ctx(
        async () => {
          throw new Error('unexpected fetch');
        },
        { occasionSpanDays: 100 },
      ),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.externalId).toBe('cbis:2866558');
  });

  it('keeps a product that has no occasions and leaves the dates empty', () => {
    const product: GladaProduct = {
      id: 'cbis:2866558',
      title: 'Blomstrande väggar',
      path: '/sv/blomstrande-vaggar',
      organizerName: 'Hälsingland Museum',
      links: [],
      occasions: [],
    };
    const [event] = gladaHudik.map({ ...raw, products: [product] });
    expect(event?.externalId).toBe('cbis:2866558');
    expect(event?.title).toBe('Blomstrande väggar');
    expect(event?.startsAt).toBeUndefined();
    expect(event?.endsAt).toBeUndefined();
  });

  it('rolls a past one-off into the next year and wraps Oct to May', () => {
    const now = new Date('2026-10-14T08:00:00.000Z');
    expect(assignOccasionYears([{ day: 15, month: 5, start: '19:00', venue: 'A' }], now)).toEqual([
      2027,
    ]);
    expect(
      assignOccasionYears(
        [
          { day: 12, month: 10, start: '10:00' },
          { day: 14, month: 5, start: '10:00' },
        ],
        now,
      ),
    ).toEqual([2026, 2027]);
  });
});

describe('glada-hudik fetch', () => {
  it('loads the unfiltered list and then each event page', async () => {
    const calls: string[] = [];
    const card = '<a href="/sv/fredrik-andersson-too-soon" data-productid="cbis:2823720">Show</a>';
    const fetched = await gladaHudik.fetchRaw(
      ctx(async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/api/cbis-product-list')) {
          const page = new URL(url).searchParams.get('page');
          if (page === '0') return json({ totalCount: 1, items: [card] });
          return json({ totalCount: 1, items: [] });
        }
        return new Response(showHtml, { status: 200, headers: { 'content-type': 'text/html' } });
      }),
    );
    expect(calls[0]).toBe('https://www.gladahudik.se/sv/api/cbis-product-list?nodeId=841&page=0');
    expect(
      calls.some((url) => /[?&](order|occasion|filter|search|categories|geo|arena)=/.test(url)),
    ).toBe(false);
    expect(calls[1]).toBe('https://www.gladahudik.se/sv/fredrik-andersson-too-soon');
    expect(calls.some((url) => url.includes('photon.komoot.io'))).toBe(false);
    expect(fetched.products).toHaveLength(1);
    expect(fetched.products[0]?.title).toBe('Fredrik Andersson - TOO SOON');
  });

  it('keeps a page without a map unpointed and stores the contact address', async () => {
    const noMap = withoutMap(showHtml);
    const calls: string[] = [];
    const card = '<a href="/sv/fredrik-andersson-too-soon" data-productid="cbis:2823720">Show</a>';
    const fetched = await gladaHudik.fetchRaw(
      ctx(async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/api/cbis-product-list')) {
          const page = new URL(url).searchParams.get('page');
          if (page === '0') return json({ totalCount: 1, items: [card] });
          return json({ totalCount: 1, items: [] });
        }
        return new Response(noMap, { status: 200, headers: { 'content-type': 'text/html' } });
      }),
    );
    expect(calls.some((url) => url.includes('photon.komoot.io'))).toBe(false);
    expect(fetched.products[0]?.location).toBeUndefined();
    const [event] = gladaHudik.map(fetched);
    expect(event?.location).toBeUndefined();
    expect(event?.venueName).toBe('Kulturhuset Glada Hudik');
    expect(event?.meta?.address).toMatchObject({
      address: 'Kulturhuset Glada Hudik, Storgatan 37',
      zipCode: '82452',
      city: 'Hudiksvall',
    });
  });

  it('leaves a digital showing without a point', async () => {
    const digital = withoutMap(showHtml).replace(
      '<span>Kulturhuset Glada Hudik</span>',
      '<span>Digitalt</span>',
    );
    const calls: string[] = [];
    const card = '<a href="/sv/digitalt" data-productid="cbis:9">Digital</a>';
    const fetched = await gladaHudik.fetchRaw(
      ctx(
        async (input) => {
          const url = String(input);
          calls.push(url);
          if (url.includes('/api/cbis-product-list')) {
            const page = new URL(url).searchParams.get('page');
            if (page === '0') return json({ totalCount: 1, items: [card] });
            return json({ totalCount: 1, items: [] });
          }
          return new Response(digital, { status: 200, headers: { 'content-type': 'text/html' } });
        },
        { geocodeDelayMs: 0 },
      ),
    );
    expect(calls.some((url) => url.includes('photon.komoot.io'))).toBe(false);
    expect(fetched.products[0]?.location).toBeUndefined();
    const [event] = gladaHudik.map(fetched);
    expect(event?.mode).toBe('digital');
    expect(event?.location).toBeUndefined();
  });

  it('does not ask Ollama while fetching', async () => {
    const ollamaCalls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      ollamaCalls.push(String(input));
      throw new Error('ollama should not be called');
    });
    const card = '<a href="/sv/fredrik-andersson-too-soon" data-productid="cbis:2823720">Show</a>';
    try {
      const fetched = await gladaHudik.fetchRaw(
        ctx(
          async (input) => {
            const url = String(input);
            if (url.includes('/api/cbis-product-list')) {
              const page = new URL(url).searchParams.get('page');
              if (page === '0') return json({ totalCount: 1, items: [card] });
              return json({ totalCount: 1, items: [] });
            }
            return new Response(showHtml, {
              status: 200,
              headers: { 'content-type': 'text/html' },
            });
          },
          {
            tagCatalog: [{ externalId: 'visit-soderhamn:30224', name: 'Utställning' }],
            existingEventTags: [
              {
                externalId: 'cbis:2823720:2026-10-15T19:00:00:2026-10-15T20:20:00',
                tag: { externalId: 'visit-soderhamn:30192', name: 'Idrott & Tävlingar' },
              },
            ],
          },
        ),
      );
      expect(ollamaCalls).toEqual([]);
      const [event] = gladaHudik.map(fetched);
      expect(event?.tags).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('saves each event before fetching the next page', async () => {
    const store = createMemoryIngestStore();
    store.sources.push({
      id: '44444444-4444-4444-8444-4444444444aa',
      slug: 'glada-hudik',
      trust: 'review',
      config: { delayMs: 0 },
      enabled: true,
    });
    const cards = [
      '<a href="/sv/one" data-productid="cbis:1">One</a>',
      '<a href="/sv/two" data-productid="cbis:2">Two</a>',
    ];
    let savedBeforeSecondPage = -1;
    let pages = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/chat')) {
        return json({
          message: { content: '{"externalIds":[{"id":"30224","score":95}]}' },
        });
      }
      if (url.includes('/api/cbis-product-list')) {
        const page = new URL(url).searchParams.get('page');
        if (page === '0') return json({ totalCount: 2, items: cards });
        return json({ totalCount: 2, items: [] });
      }
      pages += 1;
      if (pages === 2) savedBeforeSecondPage = store.events.length;
      return new Response(showHtml, { status: 200, headers: { 'content-type': 'text/html' } });
    });
    try {
      const summary = await persistSource(store, 'glada-hudik');
      expect(savedBeforeSecondPage).toBeGreaterThan(0);
      expect(summary.fetched).toBe(2);
      expect(summary.created + summary.skipped).toBe(2);
      expect(store.events[0]?.status).toBe('pending_scan');
      expect(store.events[0]?.tagIds).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses an origin outside Glada Hudik', async () => {
    await expect(
      gladaHudik.fetchRaw(ctx(async () => json({}), { origin: 'https://example.com' })),
    ).rejects.toThrow(/gladahudik\.se/);
  });
});

describe('glada-hudik location lookup', () => {
  const show = {
    id: 'cbis:2823720',
    placeName: 'Kulturhuset Glada Hudik',
    address: 'Kulturhuset Glada Hudik, Storgatan 37, 824 52 Hudiksvall',
    city: 'Hudiksvall',
  };

  function lookup(
    fetchImpl: typeof fetch,
    input: Parameters<typeof resolveGladaLocation>[0] = show,
  ) {
    return resolveGladaLocation(input, fetchImpl, {
      delayMs: 0,
      state: createLocationLookupState(),
    });
  }

  function photon(features: unknown[]) {
    return json({ features });
  }

  it('asks for the pin before the contact address', () => {
    expect(gladaLocationQueries(show).map((query) => query.step)).toEqual([
      'pin',
      'pin',
      'contact',
      'city',
    ]);
    expect(gladaLocationQueries(show)[0]?.text).toBe('Kulturhuset Glada Hudik');
    expect(gladaLocationQueries(show)[2]?.text).toContain('Storgatan 37');
  });

  it('uses the contact address when the pin is outside Hudiksvall', async () => {
    const queries: string[] = [];
    const point = await lookup(async (input) => {
      const query = new URL(String(input)).searchParams.get('q');
      queries.push(query ?? '');
      if (query === 'Kulturhuset Glada Hudik, Storgatan 37, 824 52 Hudiksvall') {
        return photon([
          {
            geometry: { coordinates: [17.1098132, 61.7277361] },
            properties: { street: 'Storgatan', city: 'Hudiksvall', countrycode: 'SE' },
          },
        ]);
      }
      return photon([
        {
          geometry: { coordinates: [12.0, 57.7] },
          properties: { name: 'Kulturhuset', city: 'Göteborg', countrycode: 'SE' },
        },
      ]);
    });
    expect(queries[0]).toBe('Kulturhuset Glada Hudik');
    expect(point).toEqual({ lat: 61.7277361, lng: 17.1098132 });
  });

  it('uses Hudiksvall centre when no lookup hits', async () => {
    const point = await lookup(async () => photon([]));
    expect(point).toEqual(GLADA_HUDIK_DEFAULT_LOCATION);
  });

  it('keeps a map point and does not geocode', async () => {
    let called = false;
    const point = await lookup(
      async () => {
        called = true;
        return photon([]);
      },
      { ...show, location: { lat: 61.72, lng: 17.1 } },
    );
    expect(called).toBe(false);
    expect(point).toEqual({ lat: 61.72, lng: 17.1 });
  });

  it('ignores a hit that does not share a name with the query', async () => {
    const point = await lookup(async () =>
      photon([
        {
          geometry: { coordinates: [17.11, 61.72] },
          properties: {
            name: 'Fonus',
            street: 'Drottninggatan',
            city: 'Hudiksvall',
            countrycode: 'SE',
          },
        },
      ]),
    );
    expect(point).toEqual(GLADA_HUDIK_DEFAULT_LOCATION);
  });
});

describe('glada-hudik tag match', () => {
  const catalog = [
    { externalId: 'visit-soderhamn:30224', name: 'Utställning' },
    { externalId: 'visit-soderhamn:30192', name: 'Idrott & Tävlingar' },
    { externalId: 'visit-soderhamn:30216', name: 'Mässor & Utställningar' },
    { externalId: 'visit-soderhamn:30184', name: 'Jul & Nyår' },
  ];

  it('leaves the kulturfestival tag out of the catalog', () => {
    expect(
      tagCatalog({
        tagCatalog: [
          {
            externalId: 'visit-soderhamn:1',
            name: 'Söderhamns kulturfestival',
            slug: 'soderhamns-kulturfestival',
          },
          { externalId: 'visit-soderhamn:30224', name: 'Utställning', slug: 'utstallning' },
        ],
      }),
    ).toEqual([{ externalId: 'visit-soderhamn:30224', name: 'Utställning' }]);
  });

  it('keeps catalog ids the model returns', () => {
    const scan = (possibleTags: unknown[]) =>
      parseTagChoices(
        {
          possiblePublishers: [],
          possibleDuplicates: [],
          contentVerdict: 'safe',
          possibleTags,
          summary: '',
          language: 'sv',
          instructions: [],
        } as never,
        catalog,
      );
    expect(scan([{ id: 'visit-soderhamn:30224', score: 96 }])).toEqual([catalog[0]]);
    expect(scan([{ id: '30224', score: 91 }])).toEqual([catalog[0]]);
    expect(scan([{ id: 30224, score: 100 }])).toEqual([catalog[0]]);
    expect(
      scan([
        { id: '30224', score: 95 },
        { id: 'visit-soderhamn:30192', score: 99 },
        { id: '30216', score: 91 },
        { id: '30224', score: 98 },
        { id: 'nope', score: 100 },
        { id: '30184', score: 90 },
        { id: '30184', score: 40 },
      ]),
    ).toEqual([catalog[0], catalog[1], catalog[2], catalog[3]]);
    expect(scan([])).toEqual([]);
    expect(scan([{ id: 'made-up', score: 99 }])).toEqual([]);
    expect(scan([{ id: '302', score: 99 }])).toEqual([]);
    expect(scan([{ id: null, score: 99 }])).toEqual([]);
    expect(scan([{ id: '30224', score: 90 }])).toEqual([catalog[0]]);
    expect(scan(['30224'])).toEqual([]);
  });

  it('refuses an Ollama URL that is not on this machine', () => {
    expect(() => ollamaBaseUrl({ ollamaBaseUrl: 'http://10.0.0.8:11434' })).toThrow(/loopback/);
  });

  it('skips the model when OLLAMA_DISABLED is set', () => {
    const previous = process.env.OLLAMA_DISABLED;
    process.env.OLLAMA_DISABLED = '1';
    try {
      expect(ollamaDisabled()).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.OLLAMA_DISABLED;
      else process.env.OLLAMA_DISABLED = previous;
    }
  });

  it('reuses tags only for the same product', () => {
    const existing = [
      {
        externalId: 'cbis:2823720:2026-10-15T19:00:00:',
        tag: { externalId: 'visit-soderhamn:30192', name: 'Idrott & Tävlingar' },
      },
      {
        externalId: 'cbis:28237201:2026-10-15T19:00:00:',
        tag: { externalId: 'visit-soderhamn:30224', name: 'Utställning' },
      },
    ];
    expect(keptTagsForProduct('cbis:2823720', existing)).toEqual([
      {
        externalId: 'cbis:2823720:2026-10-15T19:00:00:',
        tags: [{ externalId: 'visit-soderhamn:30192', name: 'Idrott & Tävlingar' }],
      },
    ]);
    expect(keptTagsForProduct('cbis:999', existing)).toBeNull();
  });
});
