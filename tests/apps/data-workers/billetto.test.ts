import { readFileSync } from 'node:fs';
import { IncomingEvent, type SourceRunContext } from '../../../packages/ingest/src/index';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { persistSource } from '../../../apps/data-workers/src/persist';
import {
  billetto,
  mapBillettoEvent,
  parseBillettoEvent,
} from '../../../apps/data-workers/src/sources/billetto';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../apps/data-workers/src/sources/billetto/fixture.json', import.meta.url),
    'utf8',
  ),
) as unknown;

const TICKET_URL =
  'https://billetto.se/e/brutus-ostling-forelasning-biljetter-2006928?utm_source=billetto+advertising&utm_medium=publishers&utm_campaign=websites&utm_content=SE+6473947';

function event() {
  const parsed = parseBillettoEvent(fixture);
  if (!parsed) throw new Error('fixture did not parse');
  return parsed;
}

function ctx(
  fetchImpl: SourceRunContext['fetch'],
  config: Record<string, unknown> = {},
): SourceRunContext {
  return {
    sourceSlug: 'billetto',
    config: { delayMs: 0, rateLimitWaitMs: 0, cities: ['Söderhamn'], ...config },
    fetch: fetchImpl,
    log: () => undefined,
  };
}

function jsonResponse(body: unknown, status = 200, url?: string, headers?: HeadersInit): Response {
  const response = Response.json(body, { status, headers });
  if (url) Object.defineProperty(response, 'url', { value: url });
  return response;
}

function page(events: unknown[], next?: string) {
  return {
    object: 'list',
    data: events,
    has_more: Boolean(next),
    total: events.length,
    ...(next ? { next_url: next } : {}),
  };
}

function away(city = 'Stockholm') {
  return {
    ...(fixture as Record<string, unknown>),
    id: '1300',
    title: 'Borta',
    location: {
      ...(fixture as { location: Record<string, unknown> }).location,
      city,
      country_code: 'SE',
    },
  };
}

describe('billetto map', () => {
  it('keeps the showing, the major-unit price, and the UTM ticket link', () => {
    const mapped = mapBillettoEvent(event());
    expect(IncomingEvent.safeParse(mapped).success).toBe(true);
    expect(mapped).toMatchObject({
      externalId: '2006928',
      title: 'Brutus Östling - föreläsning',
      startsAt: '2026-11-15T12:00:00.000Z',
      endsAt: '2026-11-15T14:00:00.000Z',
      venueName: 'Studieförbundet Bilda Mitt',
      address: 'Kungsgatan 12, Söderhamn',
      location: { lat: 61.3036, lng: 17.0559 },
      priceAmount: 16500,
      currency: 'SEK',
      mode: 'physical',
      tags: [],
      imageUrl: 'https://billetto.imgix.net/brutus.jpg',
      sourceUrl: TICKET_URL,
      organizerName: 'Söderhamns Kameraklubb',
      categoryHints: ['Hobby & Speciella intressen', 'Fotografi', 'Föreläsning eller Seminarium'],
      meta: {
        ageLimit: 15,
        address: {
          address: 'Kungsgatan 12',
          zipCode: '82630',
          city: 'Söderhamn',
          country: 'Sweden',
          location: { lat: 61.3036, lng: 17.0559 },
        },
      },
    });
    expect(mapped.links).toEqual([
      { type: 'tickets', url: TICKET_URL, label: 'Billetto' },
      { type: 'info', url: 'https://example.com/klubben' },
    ]);
    expect(mapped.organizerKeys).toEqual(['7411183', 'söderhamns kameraklubb']);
    expect(mapped.description).toContain('En kväll med bilder.');
  });

  it('stores a free price and saves an event that has no date', () => {
    const showing = event();
    showing.priceAmount = 0;
    showing.startsAt = undefined;
    showing.endsAt = undefined;
    showing.description = undefined;
    const mapped = mapBillettoEvent(showing);
    expect(IncomingEvent.safeParse(mapped).success).toBe(true);
    expect(mapped.priceAmount).toBe(0);
    expect(mapped.currency).toBe('SEK');
    expect(mapped.meta?.freeEntry).toBe(true);
    expect(mapped.startsAt).toBeUndefined();
    expect(mapped.endsAt).toBeUndefined();
    expect(mapped.meta?.ageLimit).toBeUndefined();
  });

  it('reads a decimal amount and a kr amount when the API price is empty', () => {
    const decimal = parseBillettoEvent({
      ...(fixture as Record<string, unknown>),
      minimum_price: { amount: '80.50', currency: 'SEK' },
      description: 'Ingen extra prisrad.',
    });
    expect(mapBillettoEvent(decimal!).priceAmount).toBe(8050);

    const fromText = event();
    fromText.priceAmount = undefined;
    fromText.currency = undefined;
    fromText.description = '<p>Biljett 80 kr.</p><p>Andra raden</p>';
    const mapped = mapBillettoEvent(fromText);
    expect(mapped.priceAmount).toBe(8000);
    expect(mapped.description).toBe('Biljett 80 kr.\nAndra raden');
  });

  it('drops a venue that is only the street and a point at 0, 0', () => {
    const showing = parseBillettoEvent({
      ...(fixture as Record<string, unknown>),
      location: {
        location_name: 'Kungsgatan 12',
        address_line: 'Kungsgatan 12',
        city: 'Söderhamn',
        postal_code: '826 30',
        country_code: 'SE',
        coordinates: { latitude: 0, longitude: 0 },
      },
    });
    const mapped = mapBillettoEvent(showing!);
    expect(mapped.venueName).toBeUndefined();
    expect(mapped.location).toBeUndefined();
    expect(mapped.meta?.address?.location).toBeUndefined();
    expect(mapped.address).toBe('Kungsgatan 12, Söderhamn');
  });

  it('drops a draft and an event with no title', () => {
    expect(parseBillettoEvent({ ...(fixture as Record<string, unknown>), state: 'canceled' })).toBe(
      undefined,
    );
    expect(parseBillettoEvent({ ...(fixture as Record<string, unknown>), state: 'draft' })).toBe(
      undefined,
    );
    expect(parseBillettoEvent({ id: '1', state: 'published' })).toBeUndefined();
  });
});

describe('billetto fetch', () => {
  const previousKey = process.env.BILLETTO_API_KEY;
  const previousSecret = process.env.BILLETTO_API_SECRET_KEY;

  function restoreKeys(): void {
    if (previousKey === undefined) delete process.env.BILLETTO_API_KEY;
    else process.env.BILLETTO_API_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.BILLETTO_API_SECRET_KEY;
    else process.env.BILLETTO_API_SECRET_KEY = previousSecret;
  }

  function useKeys(): void {
    process.env.BILLETTO_API_KEY = 'test-key';
    process.env.BILLETTO_API_SECRET_KEY = 'test-secret';
  }

  it('saves a local event before the next page and drops another city', async () => {
    useKeys();
    const store = createMemoryIngestStore();
    store.sources.push({
      id: '33333333-3333-4333-8333-333333333315',
      slug: 'billetto',
      trust: 'review',
      config: { delayMs: 0, rateLimitWaitMs: 0, cities: ['Söderhamn', 'Hudiksvall'] },
      enabled: true,
    });
    const next = 'https://billetto.se/api/v3/public/events?after=2006928&limit=100';
    const hudik = {
      ...(fixture as Record<string, unknown>),
      id: '2046898',
      title: 'Soulful Sunday',
      location: {
        ...(fixture as { location: Record<string, unknown> }).location,
        city: 'Hudiksvall',
        location_name: '',
        address_line: 'Västra Tullgatan 26E',
      },
    };
    let savedBeforeNext = -1;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(new Headers(init?.headers).get('api-keypair')).toBe('test-key:test-secret');
      expect(init?.redirect).toBe('error');
      expect(url.search).not.toContain('test-secret');
      expect(url.search).not.toContain('region=');
      if (url.searchParams.get('after') === '2006928') {
        savedBeforeNext = store.events.length;
        return jsonResponse(page([hudik, away()]));
      }
      return jsonResponse(page([fixture, away()], next));
    });
    try {
      const summary = await persistSource(store, 'billetto');
      expect(savedBeforeNext).toBe(1);
      expect(summary.created).toBe(2);
      expect(store.events.map((row) => row.refId)).toEqual(['2006928', '2046898']);
      expect(store.events.map((row) => row.status)).toEqual(['pending_scan', 'pending_scan']);
      expect(store.events[0]?.priceAmount).toBe(16500);
      expect(store.events[0]?.location).toEqual({ lat: 61.3036, lng: 17.0559 });
      expect(store.events[0]?.meta?.import?.venueName).toBe('Studieförbundet Bilda Mitt');
      expect(store.events[0]?.links?.[0]?.url).toBe(TICKET_URL);
    } finally {
      vi.unstubAllGlobals();
      restoreKeys();
    }
  });

  it('retries a rate limit and skips a draft', async () => {
    useKeys();
    let calls = 0;
    try {
      const raw = await billetto.fetchRaw(
        ctx(async () => {
          calls += 1;
          if (calls === 1) {
            return jsonResponse({ object: 'list' }, 429, undefined, { 'retry-after': '0' });
          }
          return jsonResponse(
            page([
              fixture,
              { ...(fixture as Record<string, unknown>), id: '9', state: 'draft', title: 'Utkast' },
            ]),
          );
        }),
      );
      expect(calls).toBe(2);
      expect(raw.events.map((item) => item.id)).toEqual(['2006928']);
    } finally {
      restoreKeys();
    }
  });

  it('fails when the API leaves billetto.se', async () => {
    useKeys();
    try {
      await expect(
        billetto.fetchRaw(
          ctx(async () => jsonResponse(page([]), 200, 'https://evil.example/api/v3/public/events')),
        ),
      ).rejects.toThrow(/billetto\.se/);
    } finally {
      restoreKeys();
    }
  });

  it('fails when the next page leaves billetto.se', async () => {
    useKeys();
    try {
      await expect(
        billetto.fetchRaw(
          ctx(async () =>
            jsonResponse(page([fixture], 'https://evil.example/api/v3/public/events?after=1')),
          ),
        ),
      ).rejects.toThrow(/billetto\.se/);
    } finally {
      restoreKeys();
    }
  });

  it('refuses a city that is not a name', async () => {
    await expect(
      billetto.fetchRaw(
        ctx(async () => jsonResponse(page([])), { cities: ['https://evil.example'] }),
      ),
    ).rejects.toThrow(/city names/);
  });

  it('throws when the key pair is missing', async () => {
    delete process.env.BILLETTO_API_KEY;
    delete process.env.BILLETTO_API_SECRET_KEY;
    try {
      await expect(billetto.fetchRaw(ctx(async () => jsonResponse(page([]))))).rejects.toThrow(
        /BILLETTO_API_KEY/,
      );
    } finally {
      restoreKeys();
    }
  });

  it('throws when no event is in the configured cities', async () => {
    useKeys();
    try {
      await expect(
        billetto.fetchRaw(ctx(async () => jsonResponse(page([away()])))),
      ).rejects.toThrow(/no usable events/);
    } finally {
      restoreKeys();
    }
  });
});
