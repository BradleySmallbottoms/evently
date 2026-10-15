import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IncomingEvent } from '../../../packages/ingest/src/index';
import { describe, expect, it } from 'vitest';
import {
  icsDateToIso,
  icsFeed,
  parseVEvents,
} from '../../../apps/data-workers/src/sources/ics-feed';

const dir = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  join(dir, '../../../apps/data-workers/src/sources/ics-feed/fixture.ics'),
  'utf8',
);

describe('ics-feed adapter', () => {
  it('parses VEVENTs from the fixture', () => {
    const events = parseVEvents(fixture);
    expect(events).toHaveLength(2);
    expect(events[0]?.SUMMARY).toBe('Sommarkonsert i Söderhamn');
  });

  it('maps fixture to IncomingEvent shapes', async () => {
    const mapped = await icsFeed.map(
      { body: fixture, feedUrl: 'https://example.com/calendar.ics' },
      {
        sourceSlug: 'ics-feed',
        config: { feedUrl: 'https://example.com/calendar.ics' },
        fetch: globalThis.fetch,
        log: () => undefined,
      },
    );
    expect(mapped).toHaveLength(2);
    for (const item of mapped) {
      expect(() => IncomingEvent.parse(item)).not.toThrow();
    }
    expect(mapped[0]).toMatchObject({
      externalId: 'fixture-concert-2026-07-01@example.com',
      title: 'Sommarkonsert i Söderhamn',
      venueName: 'Söderhamns hamn',
      organizerKeys: ['kultur@example.com', 'kultur söderhamn'],
      links: [{ type: 'info', url: 'https://example.com/events/sommarkonsert' }],
    });
    expect(mapped[1]?.venueName).toBe('Torget, Söderhamn');
  });

  it('converts UTC and floating ICS datetimes', () => {
    expect(icsDateToIso('20260701T180000Z')).toBe('2026-07-01T18:00:00.000Z');
    const local = icsDateToIso('20260701T180000');
    expect(local).toMatch(/^2026-07-01T18:00:00[+-]\d{2}:\d{2}$/);
  });
});
