import { readFileSync } from 'node:fs';
import { IncomingEvent, type SourceRunContext } from '../../../packages/ingest/src/index';
import { describe, expect, it } from 'vitest';
import {
  mapNorticEvent,
  nortic,
  norticCityMatches,
  norticTicketUrl,
  parseNorticEvent,
  parseNorticShows,
} from '../../../apps/data-workers/src/sources/nortic';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../apps/data-workers/src/sources/nortic/fixture.json', import.meta.url),
    'utf8',
  ),
) as unknown;

const ticketHtml = readFileSync(
  new URL('../../../apps/data-workers/src/sources/nortic/fixture-ticket.html', import.meta.url),
  'utf8',
);

const multiShowHtml = `
<script type="application/ld+json">
[
  {
    "@type": "Event",
    "startDate": "2026-12-05T13:00",
    "location": {
      "name": "Söderhamns Teater - Söderhamn",
      "address": { "streetAddress": "Norrtullsgatan 12", "addressLocality": "Söderhamn", "postalCode": "826 31" }
    },
    "offers": { "price": "100.0", "priceCurrency": "SEK", "url": "https://tickets.nortic.se/dagny/show/362857" }
  },
  {
    "@type": "Event",
    "startDate": "2026-12-05T23:00",
    "location": {
      "name": "Söderhamns Teater - Söderhamn",
      "address": { "streetAddress": "Norrtullsgatan 12", "addressLocality": "Söderhamn", "postalCode": "826 31" }
    },
    "offers": { "price": "80.0", "priceCurrency": "SEK", "url": "https://tickets.nortic.se/dagny/show/362858" }
  }
]
</script>
<p>5 december 13:00 - 14:30</p>
<p>5 december 23:00 - 01:00</p>
`;

function event(shows = parseNorticShows(ticketHtml)) {
  const parsed = parseNorticEvent(fixture);
  if (!parsed) throw new Error('fixture did not parse');
  return { ...parsed, shows };
}

function ctx(fetchImpl: SourceRunContext['fetch']): SourceRunContext {
  return {
    sourceSlug: 'nortic',
    config: { delayMs: 0, cities: ['Söderhamn'], pageSize: 50 },
    fetch: fetchImpl,
    log: () => undefined,
  };
}

function jsonResponse(body: unknown, status = 200, url?: string): Response {
  const response = Response.json(body, { status });
  if (url) Object.defineProperty(response, 'url', { value: url });
  return response;
}

function textResponse(body: string, status = 200, url?: string, headers?: HeadersInit): Response {
  const response = new Response(body, { status, headers });
  if (url) Object.defineProperty(response, 'url', { value: url });
  return response;
}

describe('nortic map', () => {
  it('uses the ticket-page clock, the street, and the major-unit price', () => {
    const mapped = mapNorticEvent(event());
    expect(IncomingEvent.safeParse(mapped).success).toBe(true);
    expect(mapped).toMatchObject({
      externalId: '87180',
      title: 'Joel Nunez (USA) - Get Ready - Söderhamns Teater',
      description: 'Första stycket.\n\nAndra stycket.\n\nÅldersgräns 13 år',
      startsAt: '2027-04-07T19:00:00+02:00',
      endsAt: '2027-04-07T21:00:00+02:00',
      venueName: 'Söderhamns Teater',
      address: 'Norrtullsgatan 12, Söderhamn',
      priceAmount: 19500,
      currency: 'SEK',
      sourceUrl: 'https://tickets.nortic.se/ticket/event/87180',
      organizerName: 'NORTHEVENT AB',
      organizerKeys: ['3674', 'northevent ab'],
      categoryHints: ['Konsert'],
      tags: [],
      links: [
        { type: 'tickets', url: 'https://tickets.nortic.se/ticket/event/87180', label: 'Nortic' },
      ],
      meta: {
        ageLimit: 13,
        address: {
          address: 'Norrtullsgatan 12',
          zipCode: '82631',
          city: 'Söderhamn',
          country: 'Sweden',
        },
      },
      occasions: [
        {
          startsAt: '2027-04-07T19:00:00+02:00',
          endsAt: '2027-04-07T21:00:00+02:00',
          venueName: 'Söderhamns Teater',
          sourceKey: '361872',
        },
      ],
    });
  });

  it('keeps each showing, including one that ends after midnight', () => {
    const mapped = mapNorticEvent(event(parseNorticShows(multiShowHtml)));
    expect(mapped.priceAmount).toBe(8000);
    expect(mapped.occasions).toEqual([
      {
        startsAt: '2026-12-05T13:00:00+01:00',
        endsAt: '2026-12-05T14:30:00+01:00',
        venueName: 'Söderhamns Teater',
        sourceKey: '362857',
      },
      {
        startsAt: '2026-12-05T23:00:00+01:00',
        endsAt: '2026-12-06T01:00:00+01:00',
        venueName: 'Söderhamns Teater',
        sourceKey: '362858',
      },
    ]);
  });

  it('keeps a list span when the ticket page has no showing', () => {
    const mapped = mapNorticEvent(event([]));
    expect(mapped.startsAt).toBe('2027-04-07T17:00:00.000Z');
    expect(mapped.endsAt).toBe('2027-04-07T19:00:00.000Z');
    expect(mapped.occasions).toEqual([
      {
        startsAt: '2027-04-07T17:00:00.000Z',
        endsAt: '2027-04-07T19:00:00.000Z',
        venueName: 'Söderhamns Teater',
      },
    ]);
  });

  it('reads a free event from the description when the page has no price', () => {
    const parsed = parseNorticEvent({
      ...(fixture as Record<string, unknown>),
      description: 'Fritt inträde för alla.',
      startsAt: undefined,
      endsAt: undefined,
    });
    if (!parsed) throw new Error('fixture did not parse');
    const mapped = mapNorticEvent(parsed);
    expect(mapped.priceAmount).toBe(0);
    expect(mapped.meta?.freeEntry).toBe(true);
    expect(mapped.occasions).toBeUndefined();
  });

  it('matches a configured city and refuses another ticket host', () => {
    expect(norticCityMatches('Söderhamn', ['Söderhamn', 'Bollnäs'])).toBe(true);
    expect(norticCityMatches('Stockholm', ['Söderhamn'])).toBe(false);
    expect(norticCityMatches(undefined, ['Söderhamn'])).toBe(false);
    expect(norticTicketUrl('https://tickets.nortic.se/ticket/event/87180', '87180')?.pathname).toBe(
      '/ticket/event/87180',
    );
    expect(norticTicketUrl('https://tickets.nortic.se/ticket/ajax/87180', '87180')).toBeUndefined();
    expect(norticTicketUrl('https://tickets.nortic.se/ticket/checkout', '87180')).toBeUndefined();
    expect(norticTicketUrl('https://evil.example/ticket/event/87180', '87180')).toBeUndefined();
  });
});

describe('nortic fetch', () => {
  it('saves a city match before the next page and follows the image redirect', async () => {
    const previous = process.env.NORTIC_API_KEY;
    process.env.NORTIC_API_KEY = 'test-key';
    const calls: string[] = [];
    const headers: Array<Record<string, string>> = [];
    const fetchImpl: SourceRunContext['fetch'] = async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${url.hostname}${url.pathname}`);
      headers.push((init?.headers ?? {}) as Record<string, string>);
      if (url.pathname === '/robots.txt') return textResponse('', 404, url.href);
      if (url.hostname === 'services.nortic.se') {
        const away = {
          ...(fixture as Record<string, unknown>),
          id: '2',
          name: 'Borta',
          location: { city: 'Stockholm', venue: { name: 'Annexet' } },
        };
        return jsonResponse(
          {
            pagination: { page: 1, size: 50, totalPages: 1, totalItems: 2 },
            items: [fixture, away],
          },
          200,
          url.href,
        );
      }
      if (url.hostname === 'tickets.nortic.se') return textResponse(ticketHtml, 200, url.href);
      if (url.hostname === 'branding.nortic.io') {
        return textResponse('', 302, url.href, {
          location: 'https://ik.imagekit.io/nortic/organizer/87180.jpg',
        });
      }
      return textResponse('', 404, url.href);
    };
    try {
      const events: unknown[] = [];
      for await (const raw of nortic.each!(ctx(fetchImpl))) events.push(...raw.events);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id: '87180',
        imageUrl: 'https://ik.imagekit.io/nortic/organizer/87180.jpg',
      });
      expect(calls).toEqual([
        'services.nortic.se/robots.txt',
        'tickets.nortic.se/robots.txt',
        'services.nortic.se/api/ajar/public/v1/events',
        'tickets.nortic.se/ticket/event/87180',
        'branding.nortic.io/organizer/3674/event/87180',
      ]);
      expect(headers[2]?.['X-Api-Key']).toBe('test-key');
      expect(headers[3]?.['X-Api-Key']).toBeUndefined();
      expect(headers[4]?.['X-Api-Key']).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.NORTIC_API_KEY;
      else process.env.NORTIC_API_KEY = previous;
    }
  });

  it('keeps the list span when robots.txt disallows the ticket page', async () => {
    const previous = process.env.NORTIC_API_KEY;
    process.env.NORTIC_API_KEY = 'test-key';
    const calls: string[] = [];
    const fetchImpl: SourceRunContext['fetch'] = async (input) => {
      const url = new URL(String(input));
      calls.push(`${url.hostname}${url.pathname}`);
      if (url.hostname === 'tickets.nortic.se' && url.pathname === '/robots.txt') {
        return textResponse('User-agent: *\nDisallow: /ticket/\n', 200, url.href);
      }
      if (url.pathname === '/robots.txt') return textResponse('', 404, url.href);
      if (url.hostname === 'services.nortic.se') {
        return jsonResponse(
          { pagination: { page: 1, size: 50, totalPages: 1, totalItems: 1 }, items: [fixture] },
          200,
          url.href,
        );
      }
      if (url.hostname === 'branding.nortic.io') {
        return textResponse('', 302, url.href, { location: 'https://127.0.0.1/secret.jpg' });
      }
      throw new Error(`unexpected ${url.href}`);
    };
    try {
      const events = [];
      for await (const raw of nortic.each!(ctx(fetchImpl))) events.push(...raw.events);
      expect(calls.some((call) => call.includes('/ticket/event/'))).toBe(false);
      expect(events[0]).toMatchObject({ id: '87180', shows: [], imageUrl: undefined });
    } finally {
      if (previous === undefined) delete process.env.NORTIC_API_KEY;
      else process.env.NORTIC_API_KEY = previous;
    }
  });

  it('fails when the key is missing', async () => {
    const previous = process.env.NORTIC_API_KEY;
    delete process.env.NORTIC_API_KEY;
    try {
      await expect(nortic.fetchRaw(ctx(async () => new Response('')))).rejects.toThrow(
        'NORTIC_API_KEY is not set',
      );
    } finally {
      if (previous !== undefined) process.env.NORTIC_API_KEY = previous;
    }
  });
});
