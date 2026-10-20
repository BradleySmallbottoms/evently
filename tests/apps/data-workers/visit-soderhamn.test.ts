import { IncomingEvent, type SourceRunContext } from '../../../packages/ingest/src/index';
import { afterEach, describe, expect, it } from 'vitest';
import fixture from '../../../apps/data-workers/src/sources/visit-soderhamn/fixture.json' with { type: 'json' };
import {
  visitSoderhamn,
  type VisitProduct,
  type VisitRaw,
} from '../../../apps/data-workers/src/sources/visit-soderhamn';

const raw = fixture as VisitRaw;

function ctx(
  config: Record<string, unknown> = {},
  fetchImpl?: SourceRunContext['fetch'],
): {
  ctx: SourceRunContext;
  logs: string[];
} {
  const logs: string[] = [];
  return {
    logs,
    ctx: {
      sourceSlug: 'visit-soderhamn',
      config,
      fetch:
        fetchImpl ??
        (async () => {
          throw new Error('unexpected fetch');
        }),
      log: (message, data) => logs.push(JSON.stringify({ message, ...data })),
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('visit-soderhamn map', () => {
  const { ctx: mapCtx } = ctx();
  const events = visitSoderhamn.map(raw, mapCtx);

  it('emits one event per occasion and parses as IncomingEvent', () => {
    expect(events).toHaveLength(3);
    for (const event of events) expect(IncomingEvent.safeParse(event).success).toBe(true);
    expect(events.map((event) => event.externalId)).toEqual([
      'cbis:2678865:2025-01-31T19:00:00:2025-01-31T21:00:00',
      'cbis:2682743:2024-12-14T12:00:00:2024-12-14T15:00:00',
      'cbis:2682743:2024-12-15T12:00:00:2024-12-15T15:00:00',
    ]);
    expect(events[0]?.meta?.occasionGroupId).toBeUndefined();
    expect(events[1]?.meta?.occasionGroupId).toBe('cbis:2682743');
    expect(events[2]?.meta?.occasionGroupId).toBe('cbis:2682743');
    expect(events[1]?.links).toEqual([
      {
        type: 'info',
        url: 'https://www.facebook.com/events/1761578234599074/1761578251265739/',
      },
      { type: 'info', url: 'https://www.foreningensm.se/' },
    ]);
  });

  it('maps the bandy match with a Stockholm winter offset', () => {
    const bandy = events[0]!;
    expect(bandy.title).toBe('Broberg/Söderhamn Bandy - Edsbyns IF');
    expect(bandy.startsAt).toBe('2025-01-31T19:00:00+01:00');
    expect(bandy.endsAt).toBe('2025-01-31T21:00:00+01:00');
    expect(bandy.timezone).toBe('Europe/Stockholm');
    expect(bandy.venueName).toBe('Helsingehus Arena, Hällåsen');
    expect(bandy.arenaName).toBe('Helsingehus Arena, Hällåsen');
    expect(bandy.address).toBe('Hällåsen, 826 40 Söderhamn, Sweden');
    expect(bandy.location).toEqual({ lat: 61.2887228674144, lng: 17.0729084004415 });
    expect(bandy.sourceUrl).toBe('https://brobergsoderhamn.se/');
    expect(bandy.links).toEqual([
      { type: 'tickets', url: 'https://brobergsoderhamn.ticketco.events/se/sv' },
      { type: 'tickets', url: 'https://www.nortic.se/ticket/event/82243' },
      { type: 'info', url: 'https://brobergsoderhamn.se/' },
    ]);
    expect(bandy.organizerKeys).toEqual([
      'kansli@brobergsoderhamn.se',
      'brobergsoderhamn.se',
      'kansliet, broberg/söderhamn bandy',
    ]);
    expect(bandy.organizerName).toBe('Kansliet, Broberg/Söderhamn Bandy');
    expect(bandy.categoryHints).toEqual(['Idrott & Tävlingar', 'Bandy & Innebandy', 'Tävlingar']);
    expect(bandy.tags).toEqual([]);
    expect(bandy.imageUrl).toBe('https://images.citybreakcdn.com/image.aspx?ImageId=10290222');
    expect(bandy.imageUrls).toBeUndefined();
    expect(bandy.description).toContain('inomhusarena för bandy');
    expect(bandy.priceAmount).toBe(29_500);
    expect(bandy.currency).toBe('SEK');
    expect(bandy.meta).toEqual({
      accessibleParking: true,
      hearingLoop: true,
      accessibleToilet: true,
      address: {
        address: 'Oxtorgsgatan 5',
        zipCode: '82632',
        city: 'Söderhamn',
        country: 'Sweden',
        location: { lat: 61.2887228674144, lng: 17.0729084004415 },
      },
    });
    expect(events[1]?.location).toEqual({ lat: 61.3010138, lng: 17.0444639 });
  });

  it('keeps the API image and stores crawled page images beside it', () => {
    const [event] = visitSoderhamn.map(
      {
        categories: [],
        products: [raw.products[0]!],
        crawledImages: {
          [raw.products[0]!.Id]: ['https://cdn.example/og.jpg', 'https://cdn.example/photo.jpg'],
        },
      },
      mapCtx,
    );
    expect(event?.imageUrl).toBe('https://images.citybreakcdn.com/image.aspx?ImageId=10290222');
    expect(event?.imageUrls).toEqual([
      'https://cdn.example/og.jpg',
      'https://cdn.example/photo.jpg',
    ]);
  });

  it('uses an og image when the API has no media', () => {
    const product: VisitProduct = { ...raw.products[0]!, Media: [] };
    const [event] = visitSoderhamn.map(
      {
        categories: [],
        products: [product],
        crawledImages: {
          [product.Id]: ['https://cdn.example/og.jpg', 'https://cdn.example/photo.jpg'],
        },
      },
      mapCtx,
    );
    expect(event?.imageUrl).toBe('https://cdn.example/og.jpg');
    expect(event?.imageUrls).toEqual(['https://cdn.example/photo.jpg']);
  });

  it('leaves the hero alone when every linked page failed', () => {
    const [event] = visitSoderhamn.map(
      {
        categories: [],
        products: [raw.products[0]!],
        crawledImages: { [raw.products[0]!.Id]: null },
      },
      mapCtx,
    );
    expect(event?.imageUrl).toBe('https://images.citybreakcdn.com/image.aspx?ImageId=10290222');
    expect(event?.imageUrls).toBeUndefined();
  });

  it('collects categories under Evenemang as tags', () => {
    expect(visitSoderhamn.tags?.(raw, mapCtx)).toEqual([
      { externalId: 'visit-soderhamn:30182', name: 'Högtider' },
      { externalId: 'visit-soderhamn:30184', name: 'Jul & Nyår' },
      { externalId: 'visit-soderhamn:30192', name: 'Idrott & Tävlingar' },
      { externalId: 'visit-soderhamn:30194', name: 'Bandy & Innebandy' },
      { externalId: 'visit-soderhamn:30203', name: 'Tävlingar' },
      { externalId: 'visit-soderhamn:30216', name: 'Mässor & Utställningar' },
      { externalId: 'visit-soderhamn:30224', name: 'Utställning' },
    ]);
  });

  it('collapses a long daily exhibition into one span', () => {
    const product: VisitProduct = {
      ...raw.products[0]!,
      Occasions: Array.from({ length: 40 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 10, 13 + index));
        const day = date.toISOString().slice(0, 10);
        return {
          Start: `${day}T10:00:00`,
          End: `${day}T18:00:00`,
          Arena: { Name: 'Helsingehus Arena, Hällåsen' },
        };
      }),
    };
    const [span] = visitSoderhamn.map({ categories: [], products: [product] }, mapCtx);
    expect(span?.externalId).toBe(`${product.Id}:span`);
    expect(span?.startsAt).toBe('2026-11-13T10:00:00+01:00');
    expect(span?.endsAt).toBe('2026-12-22T18:00:00+01:00');
    expect(span?.venueName).toBe('Helsingehus Arena, Hällåsen');
    expect(span?.arenaName).toBe('Helsingehus Arena, Hällåsen');
    expect(span?.meta?.collapsed).toBe(true);
    expect(span?.meta?.occasionGroupId).toBeUndefined();
    expect(span?.meta?.occasions).toHaveLength(40);
    expect(span?.meta?.occasions?.[0]).toMatchObject({
      startsAt: '2026-11-13T10:00:00+01:00',
      endsAt: '2026-11-13T18:00:00+01:00',
      venueName: 'Helsingehus Arena, Hällåsen',
    });
    expect(span?.meta?.occasions?.at(-1)).toMatchObject({
      startsAt: '2026-12-22T10:00:00+01:00',
      endsAt: '2026-12-22T18:00:00+01:00',
    });
  });

  it('keeps a long run split when the configured span is longer, and stamps the product id', () => {
    const product: VisitProduct = {
      ...raw.products[0]!,
      Occasions: Array.from({ length: 40 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 10, 13 + index));
        const day = date.toISOString().slice(0, 10);
        return { Start: `${day}T10:00:00`, End: `${day}T18:00:00` };
      }),
    };
    const { ctx: wide } = ctx({ occasionSpanDays: 100 });
    const events = visitSoderhamn.map({ categories: [], products: [product] }, wide);
    expect(events).toHaveLength(40);
    expect(events.every((event) => event.meta?.occasionGroupId === product.Id)).toBe(true);
  });

  it('uses a summer offset', () => {
    const product: VisitProduct = {
      ...raw.products[0]!,
      Occasions: [{ Start: '2026-07-01T19:00:00', End: '2026-07-01T21:00:00' }],
    };
    const [event] = visitSoderhamn.map({ categories: [], products: [product] }, mapCtx);
    expect(event?.startsAt).toBe('2026-07-01T19:00:00+02:00');
    expect(event?.endsAt).toBe('2026-07-01T21:00:00+02:00');
  });

  it('keeps a Citybreak Z timestamp as UTC', () => {
    const product: VisitProduct = {
      ...raw.products[0]!,
      Occasions: [{ Start: '2026-10-28T15:00:00Z', End: '2026-10-28T16:00:00Z' }],
    };
    const [event] = visitSoderhamn.map({ categories: [], products: [product] }, mapCtx);
    expect(event?.startsAt).toBe('2026-10-28T15:00:00.000Z');
    expect(event?.endsAt).toBe('2026-10-28T16:00:00.000Z');
    expect(event?.externalId).toBe(`${product.Id}:2026-10-28T15:00:00Z:2026-10-28T16:00:00Z`);
  });

  it('drops a product with no source url and keeps one with no occasion', () => {
    const withoutUrl: VisitProduct = {
      ...raw.products[0]!,
      Information: raw.products[0]!.Information?.filter(
        (item) => item.Id !== 125 && item.Id !== 110,
      ),
    };
    const withoutOccasions: VisitProduct = { ...raw.products[1]!, Occasions: [] };
    const mapped = visitSoderhamn.map(
      { categories: [], products: [withoutUrl, withoutOccasions] },
      mapCtx,
    );
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.externalId).toBe(String(withoutOccasions.Id));
    expect(mapped[0]?.startsAt).toBeUndefined();
    expect(mapped[0]?.endsAt).toBeUndefined();
  });

  it('uses the website when the product has no contact, and the source name when that is missing too', () => {
    const product: VisitProduct = {
      ...raw.products[0]!,
      Information: raw.products[0]!.Information?.filter(
        (item) => item.Id !== 160 && item.Id !== 161,
      ),
    };
    const [event] = visitSoderhamn.map({ categories: [], products: [product] }, mapCtx);
    expect(event?.organizerKeys).toEqual(['brobergsoderhamn.se']);
    expect(event?.organizerName).toBeUndefined();

    const bare: VisitProduct = {
      ...product,
      Information: product.Information?.map((item) =>
        item.Id === 110 || item.Id === 125
          ? { ...item, Value: 'https://www.visitsoderhamn.se/evenemang' }
          : item,
      ),
    };
    const [fallback] = visitSoderhamn.map({ categories: [], products: [bare] }, mapCtx);
    expect(fallback?.organizerKeys).toEqual(['visit-soderhamn']);
  });

  it('uses the arena position ahead of the product position', () => {
    const product: VisitProduct = {
      ...raw.products[0]!,
      Position: { Latitude: 61.1, Longitude: 17.1 },
      Occasions: [
        {
          Start: '2025-01-31T19:00:00',
          End: '2025-01-31T21:00:00',
          Arena: {
            Name: 'Helsingehus Arena, Hällåsen',
            Position: { Latitude: 61.4, Longitude: 17.4 },
          },
        },
      ],
    };
    const [event] = visitSoderhamn.map({ categories: [], products: [product] }, mapCtx);
    expect(event?.location).toEqual({ lat: 61.4, lng: 17.4 });
  });

  it('reads price, age limit, and links from Information', () => {
    const product: VisitProduct = {
      ...raw.products[1]!,
      Information: [
        ...(raw.products[1]!.Information ?? []),
        { Id: 106, Value: '345' },
        { Id: 127, Value: '13' },
        { Id: 402, Value: 'SEK' },
        { Id: 100093, Value: 'True' },
        { Id: 101014, Value: 'True' },
      ],
    };
    const [event] = visitSoderhamn.map({ categories: [], products: [product] }, mapCtx);
    expect(event?.priceAmount).toBe(34_500);
    expect(event?.currency).toBe('SEK');
    expect(event?.meta).toEqual({
      ageLimit: 13,
      accessibleParking: true,
      visuallyImpairedAccess: true,
      occasionGroupId: 'cbis:2682743',
      address: {
        address: 'Oxtorgsgatan 5',
        zipCode: '82632',
        city: 'Söderhamn',
        country: 'Sweden',
        location: { lat: 61.3010138, lng: 17.0444639 },
      },
    });
  });

  it('prefers Price From over a price written in the description', () => {
    const product: VisitProduct = {
      ...raw.products[0]!,
      Information: raw.products[0]!.Information?.map((item) =>
        item.Id === 102 ? { ...item, Value: 'Avgift: 1600 kr, faktureras' } : item,
      ),
    };
    const [event] = visitSoderhamn.map({ categories: [], products: [product] }, mapCtx);
    expect(event?.priceAmount).toBe(29_500);
  });

  it('stores a price from the description when Information has none', () => {
    const product: VisitProduct = {
      ...raw.products[0]!,
      Information: raw.products[0]!.Information?.flatMap((item) => {
        if (item.Id === 1012 || item.Id === 106 || item.Id === 100021) return [];
        if (item.Id === 102) return [{ ...item, Value: 'Avgift: 1600 kr, faktureras' }];
        return [item];
      }),
    };
    const [event] = visitSoderhamn.map({ categories: [], products: [product] }, mapCtx);
    expect(event?.priceAmount).toBe(160_000);
    expect(event?.currency).toBe('SEK');
  });

  it('stores free entry when no amount is stated', () => {
    const product: VisitProduct = {
      ...raw.products[1]!,
      Information: [...(raw.products[1]!.Information ?? []), { Id: 100021, Value: 'True' }],
    };
    const [event] = visitSoderhamn.map({ categories: [], products: [product] }, mapCtx);
    expect(event?.priceAmount).toBe(0);
    expect(event?.meta).toEqual({
      freeEntry: true,
      occasionGroupId: 'cbis:2682743',
      address: {
        address: 'Oxtorgsgatan 5',
        zipCode: '82632',
        city: 'Söderhamn',
        country: 'Sweden',
        location: { lat: 61.3010138, lng: 17.0444639 },
      },
    });
  });
});

describe('visit-soderhamn fetch', () => {
  const previous = process.env.VISIT_SODERHAMN_API_KEY;

  afterEach(() => {
    if (previous === undefined) delete process.env.VISIT_SODERHAMN_API_KEY;
    else process.env.VISIT_SODERHAMN_API_KEY = previous;
  });

  it('pages categories before products and does not log the continue token', async () => {
    process.env.VISIT_SODERHAMN_API_KEY = 'test-key';
    const calls: { url: string; init?: RequestInit }[] = [];
    const { ctx: fetchCtx, logs } = ctx({}, async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/raw/category/getpaged/20')) {
        return json({
          ContinueToken: 'tok+en==',
          TotalResults: 2,
          Result: [{ Id: 30084, Name: 'Visit Söderhamn', Path: [30084] }],
        });
      }
      if (url.includes('/raw/category/getnext/')) {
        return json({
          TotalResults: 2,
          Result: [{ Id: 30172, Name: 'Evenemang', Path: [30084, 30099, 30172] }],
        });
      }
      if (url.endsWith('/product')) {
        return json({
          TotalResults: 1,
          Result: [raw.products[0]],
        });
      }
      return json({ message: 'unexpected' }, 404);
    });

    const fetched = await visitSoderhamn.fetchRaw(fetchCtx);
    expect(fetched.categories.map((category) => category.Id)).toEqual([30084, 30172]);
    expect(fetched.products).toHaveLength(1);
    expect(calls.map((call) => call.url).slice(0, 3)).toEqual([
      'https://cbis-rest-api.citybreak.com/v1/api/raw/category/getpaged/20',
      'https://cbis-rest-api.citybreak.com/v1/api/raw/category/getnext/tok%2Ben%3D%3D',
      'https://cbis-rest-api.citybreak.com/v1/api/product',
    ]);
    const productCall = calls[2]!;
    expect(productCall.init?.method).toBe('POST');
    expect(productCall.init?.body).toBe(
      JSON.stringify({ Categories: [30172], Page: 0, PageSize: 20 }),
    );
    expect(new Headers(productCall.init?.headers).get('ApiKey')).toBe('test-key');
    expect(new Headers(productCall.init?.headers).get('Accept-Language')).toBe('sv-se');
    expect(logs.join('\n')).not.toContain('tok+en==');
    expect(logs.join('\n')).not.toContain('tok%2Ben%3D%3D');
    expect(logs.join('\n')).not.toContain('test-key');
  });

  it('refuses to fetch products when Evenemang is missing from the tree', async () => {
    process.env.VISIT_SODERHAMN_API_KEY = 'test-key';
    const { ctx: fetchCtx } = ctx({}, async () =>
      json({ TotalResults: 1, Result: [{ Id: 30086, Name: 'Bo', Path: [30084, 30086] }] }),
    );
    await expect(visitSoderhamn.fetchRaw(fetchCtx)).rejects.toThrow(/30172/);
  });

  it('pages products until TotalResults is covered', async () => {
    process.env.VISIT_SODERHAMN_API_KEY = 'test-key';
    const bodies: unknown[] = [];
    const { ctx: fetchCtx } = ctx({ pageSize: 1 }, async (input, init) => {
      const url = String(input);
      if (url.endsWith('/raw/category/getpaged/1')) {
        return json({
          TotalResults: 1,
          Result: [{ Id: 30172, Name: 'Evenemang', Path: [30172] }],
        });
      }
      if (url.endsWith('/product')) {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        const page = body.Page as number;
        return json({
          TotalResults: 2,
          Result: [raw.products[page]],
        });
      }
      return json({ message: 'unexpected' }, 404);
    });

    const fetched = await visitSoderhamn.fetchRaw(fetchCtx);
    expect(bodies).toEqual([
      { Categories: [30172], Page: 0, PageSize: 1 },
      { Categories: [30172], Page: 1, PageSize: 1 },
    ]);
    expect(fetched.products.map((product) => product.Id)).toEqual([
      raw.products[0]!.Id,
      raw.products[1]!.Id,
    ]);
  });

  it('fails when a later product page is empty before TotalResults', async () => {
    process.env.VISIT_SODERHAMN_API_KEY = 'test-key';
    const { ctx: fetchCtx } = ctx({ pageSize: 1 }, async (input, init) => {
      const url = String(input);
      if (url.endsWith('/raw/category/getpaged/1')) {
        return json({ TotalResults: 1, Result: [{ Id: 30172, Name: 'Evenemang' }] });
      }
      const body = JSON.parse(String(init?.body));
      if (body.Page === 0) return json({ TotalResults: 2, Result: [raw.products[0]] });
      return json({ TotalResults: 2, Result: [] });
    });
    await expect(visitSoderhamn.fetchRaw(fetchCtx)).rejects.toThrow(/incomplete \(1 of 2\)/);
  });

  it('refuses a base URL that is not the Citybreak host', async () => {
    process.env.VISIT_SODERHAMN_API_KEY = 'test-key';
    let fetched = false;
    const { ctx: fetchCtx } = ctx(
      { baseUrl: 'http://169.254.169.254/latest/meta-data' },
      async () => {
        fetched = true;
        return json({});
      },
    );
    await expect(visitSoderhamn.fetchRaw(fetchCtx)).rejects.toThrow(
      /cbis-rest-api\.citybreak\.com/,
    );
    expect(fetched).toBe(false);
  });

  it('follows event links and prefers an og image when the API has no media', async () => {
    process.env.VISIT_SODERHAMN_API_KEY = 'test-key';
    const product: VisitProduct = {
      ...raw.products[0]!,
      Media: [],
      Information: raw.products[0]!.Information?.map((item) =>
        item.Id === 102 ? { ...item, Value: 'Program: https://example.com/program' } : item,
      ),
    };
    const calls: { url: string; apiKey: string | null }[] = [];
    const html = `<!doctype html><html><head>
      <meta property="og:image" content="https://cdn.example/og.jpg">
      <meta property="og:image" content="//cdn.example/second.jpg">
    </head><body>
      <img src="https://cdn.example/photo.jpg" width="1200" height="800">
      <img src="/favicon.png" width="16" height="16">
      <img src="https://cdn.example/og.jpg">
    </body></html>`;
    const { ctx: fetchCtx } = ctx({}, async (input, init) => {
      const url = String(input);
      calls.push({ url, apiKey: new Headers(init?.headers).get('ApiKey') });
      if (url.endsWith('/raw/category/getpaged/20')) {
        return json({
          TotalResults: 1,
          Result: [{ Id: 30172, Name: 'Evenemang', Path: [30172] }],
        });
      }
      if (url.endsWith('/product')) return json({ TotalResults: 1, Result: [product] });
      if (url === 'https://brobergsoderhamn.se/') {
        return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (url === 'https://example.com/program') {
        return new Response(
          '<html><img src="https://cdn.example/parsed.jpg" width="400" height="300"></html>',
          {
            status: 200,
            headers: { 'content-type': 'text/html' },
          },
        );
      }
      return json({ message: 'no page' }, 404);
    });

    const fetched = await visitSoderhamn.fetchRaw(fetchCtx);
    const [event] = visitSoderhamn.map(fetched, fetchCtx);
    expect(event?.imageUrl).toBe('https://cdn.example/og.jpg');
    expect(event?.imageUrls).toEqual([
      'https://cdn.example/second.jpg',
      'https://cdn.example/photo.jpg',
      'https://cdn.example/parsed.jpg',
    ]);
    const pages = calls.filter((call) => !call.url.includes('citybreak.com'));
    expect(pages.map((call) => call.url)).toEqual([
      'https://brobergsoderhamn.ticketco.events/se/sv',
      'https://www.nortic.se/ticket/event/82243',
      'https://brobergsoderhamn.se/',
      'https://example.com/program',
    ]);
    expect(pages.every((call) => call.apiKey === null)).toBe(true);
  });

  it('requires the API key from the environment', async () => {
    delete process.env.VISIT_SODERHAMN_API_KEY;
    const { ctx: fetchCtx } = ctx();
    await expect(visitSoderhamn.fetchRaw(fetchCtx)).rejects.toThrow(/VISIT_SODERHAMN_API_KEY/);
  });
});
