import { readFileSync } from 'node:fs';
import { IncomingEvent, type SourceRunContext } from '../../../packages/ingest/src/index';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { persistSource } from '../../../apps/data-workers/src/persist';
import {
  mapBibliotekEvent,
  parseEventPage,
  parseListPage,
  soderhamnBiblioteket,
} from '../../../apps/data-workers/src/sources/soderhamn-biblioteket';
import {
  createLocationLookupState,
  resolveBibliotekLocation,
  SODERHAMN_LIBRARY_LOCATION,
} from '../../../apps/data-workers/src/sources/soderhamn-biblioteket/location';

const origin = new URL('https://www.soderhamn.se');
const eventHtml = readFileSync(
  new URL(
    '../../../apps/data-workers/src/sources/soderhamn-biblioteket/event.html',
    import.meta.url,
  ),
  'utf8',
);

function ctx(
  fetchImpl: SourceRunContext['fetch'],
  config: Record<string, unknown> = {},
): SourceRunContext {
  return {
    sourceSlug: 'soderhamn-biblioteket',
    config: { delayMs: 0, geocodeDelayMs: 0, ...config },
    fetch: fetchImpl,
    log: () => undefined,
  };
}

function htmlResponse(body: string, status = 200, url?: string): Response {
  const response = new Response(body, {
    status,
    headers: { 'content-type': 'text/html' },
  });
  if (url) Object.defineProperty(response, 'url', { value: url });
  return response;
}

const listHtml = `<ul class="sv-channel">
  <li><a class="sol-article-item" href="/underwebbar/biblioteket/evenemang-pa-biblioteket.html">Calendar</a></li>
  <li><a class="sol-article-item" href="/underwebbar/biblioteket/evenemang-pa-biblioteket/evenemang-bibliotek/2026-08-31-sagostund-23-oktober.html">Sagostund</a></li>
  <li><a class="sol-article-item" href="/underwebbar/biblioteket/evenemang-pa-biblioteket.html;jsessionid=ABC?skip=10">Next</a></li>
  <li><a class="sol-article-item" href="/underwebbar/biblioteket/evenemangpabiblioteket/evenemangbibliotek/alfons.5.3251a3b71a0f5e658a16fe.html">Alfons</a></li>
</ul>`;

describe('soderhamn-biblioteket page parse', () => {
  const event = parseEventPage(
    eventHtml,
    '/underwebbar/biblioteket/evenemang-pa-biblioteket/evenemang-bibliotek/2026-08-31-sagostund-23-oktober.html',
    origin,
  );

  it('reads date, time, place, price, and the library desk', () => {
    expect(event).toMatchObject({
      id: '5.60d355391a04255ba408ff8',
      title: 'Sagostund 23 oktober',
      date: { year: 2026, month: 10, day: 23 },
      start: '10:00',
      end: '10:30',
      wholeDay: false,
      city: 'Söderhamn',
      place: 'Söderhamns stadsbibliotek, Köpmangatan 11, Sagorummet',
      priceText: 'Gratis',
      organizerName: 'Söderhamns stadsbibliotek',
      organizerEmail: 'biblioteket@soderhamn.se',
      imageUrl:
        'https://www.soderhamn.se/images/18.39942620191523b399a9d6/1725449155131/sagostundh%C3%B6st2024.webp',
    });
    expect(event?.intro).toContain('Sagostund för barn från 2 år');
    expect(event?.description).toContain('Ingen anmälan');
  });

  it('maps a free story hour in Stockholm time', () => {
    const mapped = mapBibliotekEvent(event!, origin.origin);
    expect(IncomingEvent.safeParse(mapped).success).toBe(true);
    expect(mapped).toMatchObject({
      externalId: '5.60d355391a04255ba408ff8',
      title: 'Sagostund 23 oktober',
      mode: 'physical',
      startsAt: '2026-10-23T10:00:00+02:00',
      endsAt: '2026-10-23T10:30:00+02:00',
      timezone: 'Europe/Stockholm',
      venueName: 'Söderhamns stadsbibliotek, Sagorummet',
      address: 'Köpmangatan 11, Söderhamn',
      priceAmount: 0,
      currency: 'SEK',
      meta: {
        freeEntry: true,
        address: { address: 'Köpmangatan 11', city: 'Söderhamn', country: 'Sweden' },
      },
      organizerName: 'Söderhamns stadsbibliotek',
      organizerKeys: ['biblioteket@soderhamn.se', 'söderhamns stadsbibliotek'],
      tags: [],
      sourceUrl:
        'https://www.soderhamn.se/underwebbar/biblioteket/evenemang-pa-biblioteket/evenemang-bibliotek/2026-08-31-sagostund-23-oktober.html',
    });
    expect(mapped?.organizerKeys).not.toContain('johan.anderung@soderhamn.se');
  });

  it('keeps a paid price and a winter offset', () => {
    const paid = eventHtml
      .replace('23 oktober 2026', '27 oktober 2026')
      .replace('<span>Tid:</span> 10:00', '<span>Tid:</span> 18:00')
      .replace('- 10:30', '- 19:00')
      .replace('Gratis', '50 kr');
    const parsed = parseEventPage(
      paid,
      '/underwebbar/biblioteket/evenemang-bibliotek/paid.html',
      origin,
    );
    const mapped = mapBibliotekEvent(parsed!, origin.origin);
    expect(mapped).toMatchObject({
      startsAt: '2026-10-27T18:00:00+01:00',
      endsAt: '2026-10-27T19:00:00+01:00',
      priceAmount: 5000,
      currency: 'SEK',
    });
    expect(mapped?.meta?.freeEntry).toBeUndefined();
  });

  it('treats a date without a clock as a whole day', () => {
    const undated = eventHtml.replace(
      /<div class="sol-event-info-field">\s*<span>Tid:<\/span>[\s\S]*?<\/div>/,
      '',
    );
    const parsed = parseEventPage(
      undated,
      '/underwebbar/biblioteket/evenemang-bibliotek/day.html',
      origin,
    );
    expect(parsed?.wholeDay).toBe(true);
    const mapped = mapBibliotekEvent(parsed!, origin.origin);
    expect(mapped?.startsAt).toBe('2026-10-23T00:00:00+02:00');
    expect(mapped?.endsAt).toBe(mapped?.startsAt);
  });

  it('keeps a page with no date and leaves the dates empty', () => {
    const parsed = parseEventPage(
      '<h1>No date</h1><p>Datum: lördag i november</p>',
      '/x.html',
      origin,
    );
    expect(parsed?.date).toBeUndefined();
    const mapped = mapBibliotekEvent(parsed!, origin.origin);
    expect(mapped?.title).toBe('No date');
    expect(mapped?.startsAt).toBeUndefined();
    expect(mapped?.endsAt).toBeUndefined();
  });
});

describe('soderhamn-biblioteket list', () => {
  it('keeps event paths and drops the calendar and the session link', () => {
    expect(parseListPage(listHtml, origin)).toEqual([
      '/underwebbar/biblioteket/evenemang-pa-biblioteket/evenemang-bibliotek/2026-08-31-sagostund-23-oktober.html',
      '/underwebbar/biblioteket/evenemangpabiblioteket/evenemangbibliotek/alfons.5.3251a3b71a0f5e658a16fe.html',
    ]);
  });

  it('throws when the channel list is missing', () => {
    expect(() => parseListPage('<html>offline</html>', origin)).toThrow(/event channel/);
  });

  it('pages with skip and saves each event before the next page', async () => {
    const store = createMemoryIngestStore();
    store.sources.push({
      id: '33333333-3333-4333-8333-333333333305',
      slug: 'soderhamn-biblioteket',
      trust: 'review',
      config: { delayMs: 0, geocodeDelayMs: 0, pageSize: 1 },
      enabled: true,
    });
    const pages = [
      `<ul class="sv-channel"><li><a class="sol-article-item" href="/underwebbar/biblioteket/evenemang-pa-biblioteket/evenemang-bibliotek/one.html">One</a></li></ul>`,
      `<ul class="sv-channel"><li><a class="sol-article-item" href="/underwebbar/biblioteket/evenemang-pa-biblioteket/evenemang-bibliotek/two.html">Two</a></li></ul>`,
      `<ul class="sv-channel"></ul>`,
    ];
    const requested: string[] = [];
    let savedBeforeSecondEvent = -1;
    let eventPages = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes('photon.komoot.io')) return new Response('no', { status: 503 });
      if (url.includes('evenemang-bibliotek')) {
        eventPages += 1;
        if (eventPages === 2) savedBeforeSecondEvent = store.events.length;
        const id = url.endsWith('two.html')
          ? '5.aaaaaaaaaaaaaaaaaaaaaaa2'
          : '5.aaaaaaaaaaaaaaaaaaaaaaa1';
        return htmlResponse(eventHtml.replace('5.60d355391a04255ba408ff8', id));
      }
      const skip = new URL(url).searchParams.get('skip');
      const index = skip == null ? 0 : Number(skip);
      return htmlResponse(pages[index] ?? pages[2]!);
    });
    try {
      const summary = await persistSource(store, 'soderhamn-biblioteket');
      expect(savedBeforeSecondEvent).toBe(1);
      expect(summary.created).toBe(2);
      expect(store.events.map((event) => event.status)).toEqual(['pending_scan', 'pending_scan']);
      expect(store.events.map((event) => event.refId).sort()).toEqual([
        '5.aaaaaaaaaaaaaaaaaaaaaaa1',
        '5.aaaaaaaaaaaaaaaaaaaaaaa2',
      ]);
      expect(requested.some((url) => url.includes('jsessionid'))).toBe(false);
      expect(requested.some((url) => url.includes('skip=1'))).toBe(true);
      expect(store.events[0]?.location).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails the run when every event page leaves the calendar host', async () => {
    await expect(
      soderhamnBiblioteket.fetchRaw(
        ctx(async (input) => {
          const url = String(input);
          if (url.includes('evenemang-bibliotek')) {
            return htmlResponse(eventHtml, 200, 'https://evil.example/event');
          }
          return htmlResponse(listHtml);
        }),
      ),
    ).rejects.toThrow(/no usable events/);
  });

  it('refuses an origin outside Söderhamn', async () => {
    await expect(
      soderhamnBiblioteket.fetchRaw(
        ctx(async () => htmlResponse(''), { origin: 'https://example.com' }),
      ),
    ).rejects.toThrow(/soderhamn\.se/);
  });
});

describe('soderhamn-biblioteket location', () => {
  const library = {
    venueName: 'Söderhamns stadsbibliotek, Sagorummet',
    address: 'Köpmangatan 11, Söderhamn',
    city: 'Söderhamn',
  };

  it('prefers the library building over the street midpoint', async () => {
    const point = await resolveBibliotekLocation(
      library,
      async () =>
        Response.json({
          features: [
            {
              geometry: { coordinates: [17.0558599, 61.3025885] },
              properties: { name: 'Köpmangatan', city: 'Söderhamn', countrycode: 'SE' },
            },
            {
              geometry: { coordinates: [17.0549701, 61.3023668] },
              properties: {
                name: 'Söderhamns stadsbibliotek',
                street: 'Köpmangatan',
                city: 'Söderhamn',
                countrycode: 'SE',
              },
            },
          ],
        }),
      {
        delayMs: 0,
        state: createLocationLookupState(),
      },
    );
    expect(point).toEqual({ lat: 61.3023668, lng: 17.0549701 });
  });

  it('uses the library point when the geocoder misses', async () => {
    const point = await resolveBibliotekLocation(
      library,
      async () => new Response('no', { status: 503 }),
      { delayMs: 0, state: createLocationLookupState() },
    );
    expect(point).toEqual(SODERHAMN_LIBRARY_LOCATION);
  });

  it('leaves another venue without a point when the lookup misses', async () => {
    const point = await resolveBibliotekLocation(
      { venueName: 'Folkets hus', city: 'Söderhamn' },
      async () => new Response('no', { status: 503 }),
      { delayMs: 0, state: createLocationLookupState() },
    );
    expect(point).toBeUndefined();
  });
});
