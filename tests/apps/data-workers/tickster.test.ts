import { readFileSync } from 'node:fs';
import { IncomingEvent, type SourceRunContext } from '../../../packages/ingest/src/index';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { persistSource } from '../../../apps/data-workers/src/persist';
import {
  mapTicksterEvent,
  parseTicksterEvent,
  parseTicksterOrganizer,
  tickster,
  ticksterRequestPauseMs,
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
): SourceRunContext {
  return {
    sourceSlug: 'tickster',
    config: { delayMs: 0, cities: ['Söderhamn'], ...config },
    fetch: fetchImpl,
    log: () => undefined,
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

  function restoreKey(): void {
    if (previous === undefined) delete process.env.TICKSTER_API_KEY;
    else process.env.TICKSTER_API_KEY = previous;
  }

  it('pages by city, skips a parent, and saves each showing before the next page', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    const store = createMemoryIngestStore();
    store.sources.push({
      id: '33333333-3333-4333-8333-333333333307',
      slug: 'tickster',
      trust: 'review',
      config: { delayMs: 0, pageSize: 1, cities: ['Söderhamn'] },
      enabled: true,
    });
    const child = {
      id: 'soderhamnnight01',
      name: 'Hälsinge konsert',
      startUtc: '2026-11-21T18:00:00Z',
      endUtc: '2026-11-21T20:00:00Z',
      state: 'releasedForSale',
      eventHierarchyType: 'production-child',
      infoUrl: 'https://www.tickster.com/sv/events/soderhamnnight01',
      shopUrl: 'https://secure.tickster.com/soderhamnnight01',
      organizer: { id: 'orghalsinge01', name: 'Hälsinge Konsert' },
      venue: {
        name: 'Kulturhuset Berget',
        address: 'Köpmangatan 1',
        zipCode: '826 30',
        city: 'Söderhamn',
        country: 'SE',
      },
    };
    const away = {
      ...child,
      id: 'stockholmnight01',
      venue: { ...child.venue, city: 'Stockholm' },
    };
    const parent = {
      id: 'halsingeproduction',
      name: 'Hälsinge konsert',
      eventHierarchyType: 'production',
      state: 'releasedForSale',
      venue: { city: 'Stockholm', country: 'SE' },
      description: { html: '<p>Turné.</p>' },
      products: [{ productType: 'ticket', price: { amount: 100, currency: 'SEK' }, variants: [] }],
      childEvents: [child, away],
    };
    const requested: string[] = [];
    let savedBeforeSecond = -1;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requested.push(url.pathname);
      expect(new Headers(init?.headers).get('x-api-key')).toBe('test-key');
      expect(init?.redirect).toBe('error');
      expect(url.search).not.toContain('test-key');
      expect(url.searchParams.get('query') ?? 'city:Söderhamn').toBe('city:Söderhamn');
      if (url.pathname.endsWith('/organizers/orghalsinge01')) return jsonResponse(organizerBody);
      if (url.pathname.endsWith('/events/halsingeproduction')) return jsonResponse(parent);
      if (url.pathname.endsWith('/events/soderhamnconcert01')) return jsonResponse(fixture);
      const skip = url.searchParams.get('skip');
      if (skip === '1') savedBeforeSecond = store.events.length;
      if (skip === '0') return jsonResponse({ totalItems: 2, items: [parent] });
      return jsonResponse({ totalItems: 2, items: [fixture] });
    });
    try {
      const summary = await persistSource(store, 'tickster');
      expect(savedBeforeSecond).toBe(1);
      expect(summary.created).toBe(2);
      expect(store.events.map((row) => row.status)).toEqual(['pending_scan', 'pending_scan']);
      expect(store.events.map((row) => row.refId)).toEqual([
        'soderhamnnight01',
        'soderhamnconcert01',
      ]);
      expect(requested.some((url) => url.endsWith('/events/stockholmnight01'))).toBe(false);
      expect(requested.filter((url) => url.includes('/organizers/'))).toHaveLength(1);
      expect(store.events[0]?.priceAmount).toBe(10000);
      expect(store.events[1]?.location).toEqual({ lat: 61.306, lng: 17.06 });
    } finally {
      vi.unstubAllGlobals();
      restoreKey();
    }
  });

  it('skips a cancelled showing and a city outside the configured list', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    const requested: string[] = [];
    try {
      const raw = await tickster.fetchRaw(
        ctx(async (input) => {
          const url = new URL(String(input));
          requested.push(url.pathname);
          if (url.pathname.includes('/organizers/')) return jsonResponse(organizerBody);
          if (url.pathname.endsWith('/events/soderhamnconcert01')) return jsonResponse(fixture);
          return jsonResponse({
            totalItems: 3,
            items: [
              fixture,
              {
                id: 'cancelled01',
                name: 'Inställt',
                state: 'cancelled',
                venue: { city: 'Söderhamn', country: 'SE' },
              },
              {
                id: 'goteborg01',
                name: 'Borta',
                state: 'releasedForSale',
                venue: { city: 'Göteborg', country: 'SE' },
              },
            ],
          });
        }),
      );
      expect(raw.events.map((item) => item.event.id)).toEqual(['soderhamnconcert01']);
      expect(requested.some((path) => path.endsWith('/events/cancelled01'))).toBe(false);
      expect(requested.some((path) => path.endsWith('/events/goteborg01'))).toBe(false);
    } finally {
      restoreKey();
    }
  });

  it('fails when the API leaves event.api.tickster.com', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    try {
      await expect(
        tickster.fetchRaw(
          ctx(async () => jsonResponse({ items: [] }, 200, 'https://evil.example/events')),
        ),
      ).rejects.toThrow(/event\.api\.tickster\.com/);
    } finally {
      restoreKey();
    }
  });

  it('refuses a city that is not a name', async () => {
    await expect(
      tickster.fetchRaw(ctx(async () => jsonResponse({}), { cities: ['https://evil.example'] })),
    ).rejects.toThrow(/city names/);
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

  it('retries a 429 and then reads the event', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    let detailCalls = 0;
    try {
      const raw = await tickster.fetchRaw(
        ctx(
          async (input, init) => {
            const url = new URL(String(input));
            expect(init?.headers).toMatchObject({ 'x-api-key': 'test-key' });
            expect(url.search).not.toContain('test-key');
            if (url.pathname.includes('/organizers/')) {
              return jsonResponse(organizerBody, 200, undefined, { 'x-ratelimit-remaining': '4' });
            }
            if (url.pathname.endsWith('/events/soderhamnconcert01')) {
              detailCalls += 1;
              if (detailCalls === 1) {
                return jsonResponse({ title: 'Too Many Requests' }, 429, undefined, {
                  'x-ratelimit-remaining': '0',
                });
              }
              return jsonResponse(fixture, 200, undefined, { 'x-ratelimit-remaining': '3' });
            }
            return jsonResponse({ totalItems: 1, items: [fixture] }, 200, undefined, {
              'x-ratelimit-remaining': '0',
            });
          },
          { rateLimitWaitMs: 0 },
        ),
      );
      expect(detailCalls).toBe(2);
      expect(raw.events.map((item) => item.event.id)).toEqual(['soderhamnconcert01']);
    } finally {
      restoreKey();
    }
  });

  it('stops after an hour of rate limits', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    let calls = 0;
    try {
      await expect(
        tickster.fetchRaw(
          ctx(
            async () => {
              calls += 1;
              return jsonResponse({}, 429, undefined, { 'x-ratelimit-remaining': '0' });
            },
            { rateLimitWaitMs: 0 },
          ),
        ),
      ).rejects.toThrow(/429/);
      expect(calls).toBe(13);
    } finally {
      restoreKey();
    }
  });

  it('waits out a spent rate limit before the next request', () => {
    expect(
      ticksterRequestPauseMs({
        requests: 1,
        remaining: 0,
        delayMs: 200,
        rateLimitWaitMs: 300_000,
      }),
    ).toBe(300_000);
    expect(
      ticksterRequestPauseMs({
        requests: 1,
        remaining: 3,
        delayMs: 200,
        rateLimitWaitMs: 300_000,
      }),
    ).toBe(200);
    expect(
      ticksterRequestPauseMs({
        requests: 0,
        remaining: undefined,
        delayMs: 200,
        rateLimitWaitMs: 300_000,
      }),
    ).toBe(0);
  });

  it('throws when every hit is skipped', async () => {
    process.env.TICKSTER_API_KEY = 'test-key';
    try {
      await expect(
        tickster.fetchRaw(
          ctx(async () =>
            jsonResponse({
              totalItems: 1,
              items: [
                {
                  id: 'cancelled01',
                  name: 'Inställt',
                  state: 'cancelled',
                  venue: { city: 'Söderhamn', country: 'SE' },
                },
              ],
            }),
          ),
        ),
      ).rejects.toThrow(/no usable events/);
    } finally {
      restoreKey();
    }
  });
});
