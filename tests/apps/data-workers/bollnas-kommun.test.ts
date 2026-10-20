import { readFileSync } from 'node:fs';
import { IncomingEvent, type SourceRunContext } from '../../../packages/ingest/src/index';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { persistSource } from '../../../apps/data-workers/src/persist';
import {
  bollnasKommun,
  mapBollnasItem,
  parseItem,
  type BollnasItem,
} from '../../../apps/data-workers/src/sources/bollnas-kommun';

const origin = new URL('https://bollnas.se');
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../apps/data-workers/src/sources/bollnas-kommun/fixture.json', import.meta.url),
    'utf8',
  ),
) as unknown[];

function item(id: string): BollnasItem {
  const parsed = parseItem(
    fixture.find((row) => row && typeof row === 'object' && 'id' in row && row.id === id),
    origin,
  );
  if (!parsed) throw new Error(`missing fixture ${id}`);
  return parsed;
}

function ctx(
  fetchImpl: SourceRunContext['fetch'],
  config: Record<string, unknown> = {},
): SourceRunContext {
  return {
    sourceSlug: 'bollnas-kommun',
    config: { delayMs: 0, ...config },
    fetch: fetchImpl,
    log: () => undefined,
  };
}

function jsonResponse(body: unknown, status = 200, url?: string): Response {
  const response = Response.json(body, { status });
  if (url) Object.defineProperty(response, 'url', { value: url });
  return response;
}

describe('bollnas-kommun map', () => {
  it('keeps the UTC instant, the street, and a free showing', () => {
    const mapped = mapBollnasItem(item('5_a07712b19fe9b41f3169855'));
    expect(IncomingEvent.safeParse(mapped).success).toBe(true);
    expect(mapped).toMatchObject({
      externalId: '5_a07712b19fe9b41f3169855',
      title: 'Dino Deluxe - dinosaurieutställning',
      startsAt: '2026-10-21T11:00:00.000Z',
      endsAt: '2026-10-21T14:00:00.000Z',
      venueName: 'Bollnäs konsthall',
      address: 'Odengatan 17, Bollnäs',
      priceAmount: 0,
      currency: 'SEK',
      mode: 'physical',
      tags: [],
      categoryHints: ['Barn & ungdom', 'Konst, utställning & hantverk'],
      imageUrl:
        'https://bollnas.se/images/200.69f69f7919fe0a594a0ddd91/1786954606337/Dino%20Deluxe%20evenemang.jpg',
      sourceUrl:
        'https://bollnas.se/turism/upplevbollnas/evenemang/evenemang/dinodeluxedinosaurieutstallning.5.a07712b19fe9b41f3169855.html',
      links: [
        {
          type: 'info',
          url: 'https://bollnas.se/turism/upplevbollnas/evenemang/evenemang/dinodeluxedinosaurieutstallning.5.a07712b19fe9b41f3169855.html',
        },
      ],
      meta: {
        freeEntry: true,
        address: { address: 'Odengatan 17', city: 'Bollnäs', country: 'Sweden' },
      },
    });
    expect(mapped.location).toBeUndefined();
    expect(mapped.organizerKeys).toContain('bollnäs konsthall');
    expect(mapped.organizerKeys).not.toContain('bollnas-kommun');
  });

  it('keeps the room and the museum in the venue name', () => {
    const mapped = mapBollnasItem(item('5_7c5dac1f1a01f73e04a17461'));
    expect(mapped.venueName).toBe('Ateljén, Bollnäs museum');
    expect(mapped.meta?.address).toEqual({
      address: 'Odengatan 17',
      city: 'Bollnäs',
      country: 'Sweden',
    });
  });

  it('stores a paid screening with the stated age and no price', () => {
    const mapped = mapBollnasItem(item('5_2a1030d71a13057dd283568b'));
    expect(mapped).toMatchObject({
      startsAt: '2026-10-21T13:00:00.000Z',
      endsAt: '2026-10-21T14:41:00.000Z',
      venueName: 'Biografteatern Kilafors',
      address: 'Kilafors',
      meta: { ageLimit: 11, address: { city: 'Kilafors', country: 'Sweden' } },
    });
    expect(mapped.priceAmount).toBeUndefined();
    expect(mapped.meta?.freeEntry).toBeUndefined();
  });

  it('uses the contact email and the street inside the venue line', () => {
    const mapped = mapBollnasItem(item('5_5043b83719a155643ec80d37'));
    expect(mapped.venueName).toBe('Bollnäs Cowork');
    expect(mapped.address).toBe('långgatan 26, Bollnäs');
    expect(mapped.meta?.address).toEqual({
      address: 'långgatan 26',
      city: 'Bollnäs',
      country: 'Sweden',
    });
    expect(mapped.organizerKeys[0]).toBe('sandra.williamsson@bollnas.se');
  });

  it('types ticket, registration, Facebook, and Instagram links', () => {
    const mapped = mapBollnasItem({
      ...item('5_2a1030d71a13057dd283568b'),
      content: [
        'Biljetter: https://www.tickster.com/se/sv/events/heart',
        'Anmälan: https://docs.google.com/forms/d/e/example',
        'https://www.facebook.com/biografteatern',
        'https://www.instagram.com/biografteatern',
        'https://example.com/om',
      ].join('\n'),
    });
    expect(mapped.links?.map((link) => link.type)).toEqual([
      'info',
      'tickets',
      'registration',
      'facebook',
      'instagram',
      'info',
    ]);
  });

  it('keeps a row with no date and leaves the dates empty', () => {
    const mapped = mapBollnasItem({
      ...item('5_a07712b19fe9b41f3169855'),
      startDate: undefined,
      endDate: undefined,
    });
    expect(IncomingEvent.safeParse(mapped).success).toBe(true);
    expect(mapped.startsAt).toBeUndefined();
    expect(mapped.endsAt).toBeUndefined();
  });

  it('reads a kr amount when the row is not free', () => {
    const mapped = mapBollnasItem({
      ...item('5_2a1030d71a13057dd283568b'),
      content: 'Entré 120 kr.',
    });
    expect(mapped.priceAmount).toBe(12000);
    expect(mapped.meta?.freeEntry).toBeUndefined();
  });
});

describe('bollnas-kommun fetch', () => {
  it('pages with start and saves each event before the next page', async () => {
    const store = createMemoryIngestStore();
    store.sources.push({
      id: '33333333-3333-4333-8333-333333333306',
      slug: 'bollnas-kommun',
      trust: 'review',
      config: { delayMs: 0, pageSize: 1 },
      enabled: true,
    });
    const first = fixture[0];
    const second = fixture[2];
    const requested: string[] = [];
    let savedBeforeSecond = -1;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      const start = new URL(url).searchParams.get('start');
      if (start === '1') savedBeforeSecond = store.events.length;
      const hit = start === '1' ? second : first;
      return jsonResponse({ hits: [hit], hitCount: 2 });
    });
    try {
      const summary = await persistSource(store, 'bollnas-kommun');
      expect(savedBeforeSecond).toBe(1);
      expect(summary.created).toBe(2);
      expect(store.events.map((event) => event.status)).toEqual(['pending_scan', 'pending_scan']);
      expect(store.events.map((event) => event.refId).sort()).toEqual([
        '5_2a1030d71a13057dd283568b',
        '5_a07712b19fe9b41f3169855',
      ]);
      expect(requested.some((url) => url.includes('jsessionid'))).toBe(false);
      expect(requested.some((url) => url.includes('start=1'))).toBe(true);
      expect(store.events[0]?.location).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails the run when the items route leaves bollnas.se', async () => {
    await expect(
      bollnasKommun.fetchRaw(
        ctx(async () =>
          jsonResponse({ hits: fixture, hitCount: 1 }, 200, 'https://evil.example/items'),
        ),
      ),
    ).rejects.toThrow(/bollnas\.se/);
  });

  it('refuses an origin outside Bollnäs', async () => {
    await expect(
      bollnasKommun.fetchRaw(
        ctx(async () => jsonResponse({ hits: [] }), { origin: 'https://example.com' }),
      ),
    ).rejects.toThrow(/bollnas\.se/);
  });

  it('throws when the page has no usable events', async () => {
    await expect(
      bollnasKommun.fetchRaw(ctx(async () => jsonResponse({ hits: [{ title: '' }], hitCount: 1 }))),
    ).rejects.toThrow(/no usable events/);
  });
});
