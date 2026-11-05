import { readFileSync } from 'node:fs';
import { IncomingEvent, type SourceRunContext } from '../../../packages/ingest/src/index';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { persistSource } from '../../../apps/data-workers/src/persist';
import {
  kulturbiljetter,
  mapKulturbiljetterEvent,
  parseKulturbiljetterEvent,
} from '../../../apps/data-workers/src/sources/kulturbiljetter';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../apps/data-workers/src/sources/kulturbiljetter/fixture.json', import.meta.url),
    'utf8',
  ),
) as unknown;

function event(id = '1291') {
  const parsed = parseKulturbiljetterEvent(fixture, id);
  if (!parsed) throw new Error('fixture did not parse');
  return parsed;
}

function ctx(
  fetchImpl: SourceRunContext['fetch'],
  config: Record<string, unknown> = {},
): SourceRunContext {
  return {
    sourceSlug: 'kulturbiljetter',
    config: { delayMs: 0, cities: ['Söderhamn'], ...config },
    fetch: fetchImpl,
    log: () => undefined,
  };
}

function jsonResponse(body: unknown, status = 200, url?: string): Response {
  const response = Response.json(body, { status });
  if (url) Object.defineProperty(response, 'url', { value: url });
  return response;
}

describe('kulturbiljetter map', () => {
  it('keeps each showing, the cheapest price, and the venue address', () => {
    const mapped = mapKulturbiljetterEvent(event());
    expect(IncomingEvent.safeParse(mapped).success).toBe(true);
    expect(mapped).toMatchObject({
      externalId: '1291',
      title: 'Hälsinge konsert',
      startsAt: '2026-11-14T17:00:00.000Z',
      endsAt: '2026-11-21T18:00:00.000Z',
      venueName: 'Kulturhuset Berget',
      address: 'Köpmangatan 1, Söderhamn',
      priceAmount: 15000,
      currency: 'SEK',
      mode: 'physical',
      tags: [],
      categoryHints: [],
      imageUrl: 'https://kulturbiljetter.se/storage/halsinge-konsert.jpg',
      imageUrls: ['https://kulturbiljetter.se/storage/halsinge-konsert-2.jpg'],
      sourceUrl: 'https://kulturbiljetter.se/evenemang/1291/halsinge-konsert/',
      organizerName: 'Hälsinge Konsert',
      meta: {
        ageLimit: 15,
        address: {
          address: 'Köpmangatan 1',
          city: 'Söderhamn',
          country: 'Sweden',
        },
      },
    });
    expect(mapped.location).toBeUndefined();
    expect(mapped.meta?.freeEntry).toBeUndefined();
    expect(mapped.meta?.address?.location).toBeUndefined();
    expect(mapped.description).toContain('En kväll med musik & dans');
    expect(mapped.occasions).toEqual([
      {
        startsAt: '2026-11-14T17:00:00.000Z',
        endsAt: '2026-11-14T17:00:00.000Z',
        venueName: 'Kulturhuset Berget',
        sourceKey: '1021',
      },
      {
        startsAt: '2026-11-21T18:00:00.000Z',
        endsAt: '2026-11-21T18:00:00.000Z',
        venueName: 'Kulturhuset Berget',
        sourceKey: '1022',
      },
    ]);
    expect(mapped.links).toEqual([
      {
        type: 'tickets',
        url: 'https://kulturbiljetter.se/varukorg/1291/halsinge-konsert',
        label: 'Kulturbiljetter',
      },
      { type: 'info', url: 'https://kulturbiljetter.se/evenemang/1291/halsinge-konsert' },
      { type: 'info', url: 'https://example.com/band', label: 'Bandet' },
    ]);
    expect(mapped.organizerKeys).toEqual(['1023', 'hälsinge konsert']);
  });

  it('stores a free price and saves an event that has no date', () => {
    const showing = event();
    showing.priceMin = 0;
    showing.dates = [];
    showing.longHtml = undefined;
    showing.shortHtml = undefined;
    const mapped = mapKulturbiljetterEvent(showing);
    expect(IncomingEvent.safeParse(mapped).success).toBe(true);
    expect(mapped.priceAmount).toBe(0);
    expect(mapped.currency).toBe('SEK');
    expect(mapped.meta?.freeEntry).toBe(true);
    expect(mapped.startsAt).toBeUndefined();
    expect(mapped.endsAt).toBeUndefined();
    expect(mapped.occasions).toBeUndefined();
  });

  it('reads a kr amount when the API price is empty', () => {
    const showing = event();
    showing.priceMin = undefined;
    showing.longHtml = '<p>Biljett 80 kr.</p>';
    const mapped = mapKulturbiljetterEvent(showing);
    expect(mapped.priceAmount).toBe(8000);
    expect(mapped.meta?.ageLimit).toBeUndefined();
  });
});

describe('kulturbiljetter fetch', () => {
  const previous = process.env.KULTURBILJETTER_API_KEY;

  function restoreKey(): void {
    if (previous === undefined) delete process.env.KULTURBILJETTER_API_KEY;
    else process.env.KULTURBILJETTER_API_KEY = previous;
  }

  it('saves a local event before the next detail and drops another city', async () => {
    process.env.KULTURBILJETTER_API_KEY = 'test-key';
    const store = createMemoryIngestStore();
    store.sources.push({
      id: '33333333-3333-4333-8333-333333333308',
      slug: 'kulturbiljetter',
      trust: 'review',
      config: { delayMs: 0, cities: ['Söderhamn', 'Bollnäs'] },
      enabled: true,
    });
    const away = {
      ...(fixture as Record<string, unknown>),
      locations: {
        '0': {
          location_id: 2000,
          name: 'Stadsteatern',
          street: 'Sveavägen 1',
          city: 'Stockholm',
        },
      },
      dates: {
        '0': {
          date_id: 3000,
          location_id: 2000,
          unixtime_start: 1794675600,
          date_only: false,
        },
      },
    };
    const bollnas = {
      ...(fixture as Record<string, unknown>),
      locations: {
        '0': {
          location_id: 1192,
          name: 'Kulturhuset',
          street: 'Storgatan 2',
          city: 'Bollnäs',
        },
      },
      dates: {
        '0': {
          date_id: 1023,
          location_id: 1192,
          unixtime_start: 1794675600,
          date_only: false,
        },
      },
    };
    const requested: string[] = [];
    let savedBeforeBollnas = -1;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requested.push(url.pathname);
      expect(new Headers(init?.headers).get('authorization')).toBe('Token test-key');
      expect(init?.redirect).toBe('error');
      expect(url.search).not.toContain('test-key');
      if (url.pathname.endsWith('/events/1300')) return jsonResponse(away);
      if (url.pathname.endsWith('/events/1301')) {
        savedBeforeBollnas = store.events.length;
        return jsonResponse(bollnas);
      }
      if (url.pathname.endsWith('/events/1291')) return jsonResponse(fixture);
      return jsonResponse({
        '0': { event_id: 1291, organizer_id: 1023, ETag: 'a' },
        '1': { event_id: 1300, organizer_id: 1, ETag: 'b' },
        '2': { event_id: 1301, organizer_id: 2, ETag: 'c' },
      });
    });
    try {
      const summary = await persistSource(store, 'kulturbiljetter');
      expect(savedBeforeBollnas).toBe(1);
      expect(summary.created).toBe(2);
      expect(store.events.map((row) => row.refId)).toEqual(['1291', '1301']);
      expect(store.events.map((row) => row.status)).toEqual(['pending_scan', 'pending_scan']);
      expect(requested.some((path) => path.endsWith('/events/1300'))).toBe(true);
      expect(store.events[0]?.priceAmount).toBe(15000);
      expect(store.events[0]?.location).toBeUndefined();
      expect(store.events[0]?.occasions).toHaveLength(2);
      expect(store.events[0]?.meta?.import?.venueName).toBe('Kulturhuset Berget');
    } finally {
      vi.unstubAllGlobals();
      restoreKey();
    }
  });

  it('keeps only the showing whose city is configured', async () => {
    process.env.KULTURBILJETTER_API_KEY = 'test-key';
    const mixed = {
      ...(fixture as Record<string, unknown>),
      locations: {
        '0': {
          location_id: 1191,
          name: 'Kulturhuset Berget',
          street: 'Köpmangatan 1',
          city: 'Söderhamn',
        },
        '1': {
          location_id: 2000,
          name: 'Stadsteatern',
          street: 'Sveavägen 1',
          city: 'Stockholm',
        },
      },
      dates: {
        '0': {
          date_id: 1021,
          location_id: 1191,
          unixtime_start: 1794675600,
          date_only: false,
        },
        '1': {
          date_id: 3000,
          location_id: 2000,
          unixtime_start: 1795284000,
          date_only: false,
        },
      },
    };
    try {
      const raw = await kulturbiljetter.fetchRaw(
        ctx(async (input) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith('/events/1291')) return jsonResponse(mixed);
          return jsonResponse({ '0': { event_id: 1291, organizer_id: 1023 } });
        }),
      );
      expect(raw.events[0]?.dates.map((date) => date.dateId)).toEqual(['1021']);
      const mapped = mapKulturbiljetterEvent(raw.events[0]!);
      expect(mapped.occasions?.map((occasion) => occasion.sourceKey)).toEqual(['1021']);
      expect(mapped.venueName).toBe('Kulturhuset Berget');
    } finally {
      restoreKey();
    }
  });

  it('skips a missing event and still saves the next one', async () => {
    process.env.KULTURBILJETTER_API_KEY = 'test-key';
    try {
      const raw = await kulturbiljetter.fetchRaw(
        ctx(async (input) => {
          const url = new URL(String(input));
          if (url.pathname.endsWith('/events/404')) return jsonResponse({ title: 'Missing' }, 404);
          if (url.pathname.endsWith('/events/1291')) return jsonResponse(fixture);
          return jsonResponse({
            '0': { event_id: 404, organizer_id: 1 },
            '1': { event_id: 1291, organizer_id: 1023 },
          });
        }),
      );
      expect(raw.events.map((item) => item.id)).toEqual(['1291']);
    } finally {
      restoreKey();
    }
  });

  it('fails when the API leaves kulturbiljetter.se', async () => {
    process.env.KULTURBILJETTER_API_KEY = 'test-key';
    try {
      await expect(
        kulturbiljetter.fetchRaw(
          ctx(async () => jsonResponse({}, 200, 'https://evil.example/api/v3/events/')),
        ),
      ).rejects.toThrow(/kulturbiljetter\.se/);
    } finally {
      restoreKey();
    }
  });

  it('refuses a city that is not a name', async () => {
    await expect(
      kulturbiljetter.fetchRaw(
        ctx(async () => jsonResponse({}), { cities: ['https://evil.example'] }),
      ),
    ).rejects.toThrow(/city names/);
  });

  it('throws when the key is missing', async () => {
    delete process.env.KULTURBILJETTER_API_KEY;
    try {
      await expect(kulturbiljetter.fetchRaw(ctx(async () => jsonResponse({})))).rejects.toThrow(
        /KULTURBILJETTER_API_KEY/,
      );
    } finally {
      restoreKey();
    }
  });

  it('throws when no showing is in the configured cities', async () => {
    process.env.KULTURBILJETTER_API_KEY = 'test-key';
    try {
      await expect(
        kulturbiljetter.fetchRaw(
          ctx(async (input) => {
            const url = new URL(String(input));
            if (url.pathname.endsWith('/events/1300')) {
              return jsonResponse({
                title: 'Borta',
                locations: { '0': { location_id: 1, city: 'Stockholm' } },
                dates: {
                  '0': { date_id: 1, location_id: 1, unixtime_start: 1794675600, date_only: false },
                },
              });
            }
            return jsonResponse({ '0': { event_id: 1300, organizer_id: 1 } });
          }),
        ),
      ).rejects.toThrow(/no usable events/);
    } finally {
      restoreKey();
    }
  });
});
