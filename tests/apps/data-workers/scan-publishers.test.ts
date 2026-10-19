import { describe, expect, it } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { saveIncomingEvents } from '../../../apps/data-workers/src/persist';
import type { PromptRunner, ScanOutcome } from '../../../apps/data-workers/src/prompt-runners';
import { scanPendingEvents } from '../../../apps/data-workers/src/scan-pending';
import { scanPendingPublishers } from '../../../apps/data-workers/src/scan-publishers';
import type { SourceRecord } from '../../../apps/data-workers/src/store';

const source: SourceRecord = {
  id: '33333333-3333-4333-8333-333333333301',
  slug: 'visit-soderhamn',
  trust: 'auto_publish',
  config: {},
  enabled: true,
};

const event = {
  externalId: 'cbis:1',
  title: 'Konsert',
  description: 'En kväll med musik',
  mode: 'physical' as const,
  startsAt: '2027-06-01T18:00:00.000Z',
  endsAt: '2027-06-01T21:00:00.000Z',
  timezone: 'Europe/Stockholm',
  venueName: 'Helsingehus',
  location: { lat: 61.3, lng: 17.07 },
  sourceUrl: 'https://example.com/konsert',
  organizerKeys: ['kansli@example.com'],
  organizerName: 'Föreningen',
  categoryHints: [],
  tags: [] as { externalId: string; name: string }[],
};

const scanned = {
  contentVerdict: 'safe' as const,
  llmOutput: null,
  summary: 'Musik',
  language: 'sv',
  instructions: [] as string[],
};

const env = { BRAVE_API_KEY: 'test-key' };

function temporaryRunner(): PromptRunner {
  return {
    id: 'temporary',
    lookupPublisher: async () => ({ ok: true, profile: null }),
    async scan(batch) {
      return batch.map(
        (item): ScanOutcome => ({
          ok: true,
          eventId: item.eventId,
          publisher: {
            kind: 'temporary',
            name: 'Föreningen',
            organizerKeys: item.organizer.keys,
          },
          duplicate: null,
          approved: true,
          tags: [],
          ...scanned,
        }),
      );
    },
  };
}

describe('scanPendingPublishers', () => {
  it('stores a looked-up website and moves the publisher to review', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    await scanPendingEvents(store, temporaryRunner());
    const publisherId = store.events[0]?.publisherId;
    expect(publisherId).toBeTruthy();

    const summary = await scanPendingPublishers(
      store,
      {
        id: 'lookup',
        lookupPublisher: async () => ({
          ok: true,
          profile: {
            name: 'Föreningen',
            website: 'https://www.foreningen.se/om/',
            address: 'Storgatan 1',
            city: 'Söderhamn',
            description: 'En lokal förening',
            sources: [{ url: 'https://foreningen.se/om' }],
          },
        }),
        scan: async () => [],
      },
      { env },
    );

    expect(summary).toMatchObject({ claimed: 1, reviewed: 1, unavailable: 0 });
    const publisher = await store.getPublisher(publisherId!);
    expect(publisher?.status).toBe('in_review');
    expect(publisher?.organizerKeys).toEqual(
      expect.arrayContaining(['kansli@example.com', 'foreningen.se/om', 'foreningen.se']),
    );
    expect(publisher?.lookup?.website).toBe('https://www.foreningen.se/om/');
  });

  it('moves a finished lookup with no facts to review', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    await scanPendingEvents(store, temporaryRunner());

    const summary = await scanPendingPublishers(
      store,
      {
        id: 'empty',
        lookupPublisher: async () => ({ ok: true, profile: null }),
        scan: async () => [],
      },
      { env },
    );

    expect(summary.reviewed).toBe(1);
    const publisher = await store.getPublisher(store.events[0]!.publisherId!);
    expect(publisher?.status).toBe('in_review');
    expect(publisher?.lookup).toBeNull();
  });

  it('leaves the publisher pending when the lookup fails', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    await scanPendingEvents(store, temporaryRunner());

    const summary = await scanPendingPublishers(
      store,
      {
        id: 'down',
        lookupPublisher: async () => {
          throw new Error('search down');
        },
        scan: async () => [],
      },
      { env },
    );

    expect(summary).toMatchObject({ unavailable: 1, reviewed: 0 });
    const publisher = await store.getPublisher(store.events[0]!.publisherId!);
    expect(publisher?.status).toBe('pending_scan');
    expect(publisher?.lookup).toBeNull();
  });

  it('does not store a social website as an organizer key', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    await scanPendingEvents(store, temporaryRunner());

    await scanPendingPublishers(
      store,
      {
        id: 'social',
        lookupPublisher: async () => ({
          ok: true,
          profile: {
            name: null,
            website: 'https://facebook.com/foreningen',
            address: null,
            city: null,
            description: null,
            sources: [],
          },
        }),
        scan: async () => [],
      },
      { env },
    );

    const publisher = await store.getPublisher(store.events[0]!.publisherId!);
    expect(publisher?.organizerKeys).toEqual(['kansli@example.com']);
    expect(publisher?.lookup?.website).toBe('https://facebook.com/foreningen');
    expect(publisher?.status).toBe('in_review');
  });

  it('claims nothing when web search is not configured', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    await scanPendingEvents(store, temporaryRunner());
    let lookups = 0;

    const summary = await scanPendingPublishers(
      store,
      {
        id: 'no-key',
        lookupPublisher: async () => {
          lookups += 1;
          return { ok: true, profile: null };
        },
        scan: async () => [],
      },
      { env: {} },
    );

    expect(summary).toMatchObject({ claimed: 0, reason: 'no_brave_api_key' });
    expect(lookups).toBe(0);
    expect(store.publishers[0]?.status).toBe('pending_scan');
  });

  it('does not move a publisher an admin already published', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    await scanPendingEvents(store, temporaryRunner());

    const summary = await scanPendingPublishers(
      store,
      {
        id: 'published-midway',
        lookupPublisher: async (input) => {
          const publisher = store.publishers.find((item) => item.id === input.publisherId);
          if (publisher) publisher.status = 'published';
          return { ok: true, profile: null };
        },
        scan: async () => [],
      },
      { env },
    );

    expect(summary).toMatchObject({ skipped: 1, reviewed: 0 });
    expect(store.publishers[0]?.status).toBe('published');
  });
});
