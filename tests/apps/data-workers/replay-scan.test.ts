import type { DomainEvent } from '../../../packages/contracts/src/domain-events';
import { describe, expect, it } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { saveIncomingEvents } from '../../../apps/data-workers/src/persist';
import { replayStoredScans } from '../../../apps/data-workers/src/replay-scan';
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
  description: 'En kvall med musik',
  mode: 'physical' as const,
  startsAt: '2027-06-01T18:00:00.000Z',
  endsAt: '2027-06-01T21:00:00.000Z',
  timezone: 'Europe/Stockholm',
  venueName: 'Helsingehus',
  location: { lat: 61.3, lng: 17.07 },
  sourceUrl: 'https://example.com/konsert',
  organizerKeys: ['kansli@example.com'],
  organizerName: 'Foreningen',
  categoryHints: [],
  tags: [] as { externalId: string; name: string }[],
};

function openAiScanOutput(record: Record<string, unknown>): object {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(record),
        },
      },
    ],
  };
}

function anthropicScanOutput(record: Record<string, unknown>): object {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(record),
      },
    ],
  };
}

describe('replayStoredScans', () => {
  it('replays OpenAI payloads and bare scan objects without a model call', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await store.upsertTags([{ externalId: 'visit-soderhamn:30194', name: 'Musik' }]);
    const publisher = store.linkPublisher({
      sourceId: source.id,
      organizerKey: event.organizerKeys[0]!,
      name: 'Foreningen',
      isTemporary: false,
      status: 'published',
    });
    await saveIncomingEvents(store, source, [
      event,
      { ...event, externalId: 'cbis:2', title: 'Marknad', organizerName: 'Marknadsforeningen' },
    ]);
    const [first, second] = store.events;
    first!.status = 'in_review';
    second!.status = 'in_review';
    first!.llmOutput = openAiScanOutput({
      contentVerdict: 'safe',
      possibleTags: [{ id: 'visit-soderhamn:30194', score: 95 }],
      possiblePublishers: [{ publisherId: publisher.publisherId, rank: 95 }],
      possibleDuplicates: [],
      summary: 'Musik i Helsingehus',
      language: 'sv',
      instructions: ['Ta med biljett'],
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      possibleVenueNames: [{ name: 'Helsingehus', rank: 95 }],
    });
    second!.llmOutput = {
      contentVerdict: 'safe',
      possibleTags: [{ id: 'visit-soderhamn:30194', score: 93 }],
      possiblePublishers: [{ publisherId: publisher.publisherId, rank: 93 }],
      possibleDuplicates: [],
      summary: 'Marknad i centrum',
      language: 'sv',
      instructions: [],
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      possibleVenueNames: [{ name: 'Helsingehus', rank: 81 }],
    };

    const summary = await replayStoredScans(store);

    expect(summary).toMatchObject({ claimed: 2, published: 2, review: 0, skipped: 0 });
    expect(store.events.every((row) => row.status === 'published')).toBe(true);
    expect(store.events.every((row) => row.publisherId === publisher.publisherId)).toBe(true);
    expect(store.events[0]?.meta.instructions).toEqual(['Ta med biljett']);
  });

  it('re-enqueues event.published when a published event is replayed', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await store.upsertTags([{ externalId: 'visit-soderhamn:30194', name: 'Musik' }]);
    const publisher = store.linkPublisher({
      sourceId: source.id,
      organizerKey: event.organizerKeys[0]!,
      name: 'Foreningen',
      isTemporary: false,
      status: 'published',
    });
    await saveIncomingEvents(store, source, [event]);
    const row = store.events[0]!;
    row.status = 'published';
    row.publisherId = publisher.publisherId;
    row.llmOutput = openAiScanOutput({
      contentVerdict: 'safe',
      possibleTags: [{ id: 'visit-soderhamn:30194', score: 90 }],
      possiblePublishers: [{ publisherId: publisher.publisherId, rank: 95 }],
      possibleDuplicates: [],
      summary: 'Musik i Helsingehus',
      language: 'sv',
      instructions: [],
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      possibleVenueNames: [],
    });
    const published: DomainEvent[] = [];

    await replayStoredScans(store, {
      async publish(entry) {
        published.push(entry);
      },
    });

    expect(published).toContainEqual({ type: 'event.published', eventId: row.id });
  });

  it('does not emit tip.scanned again for an already published replay row', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const publisher = store.linkPublisher({
      sourceId: source.id,
      organizerKey: event.organizerKeys[0]!,
      name: 'Foreningen',
      isTemporary: false,
      status: 'published',
    });
    await saveIncomingEvents(store, source, [event]);
    const row = store.events[0]!;
    row.status = 'published';
    row.publisherId = publisher.publisherId;
    row.llmOutput = openAiScanOutput({
      contentVerdict: 'safe',
      possibleTags: [],
      possiblePublishers: [{ publisherId: publisher.publisherId, rank: 95 }],
      possibleDuplicates: [],
      summary: 'Musik i Helsingehus',
      language: 'sv',
      instructions: [],
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      possibleVenueNames: [],
    });
    store.tipLinks.set(row.id, '11111111-1111-4111-8111-111111111111');
    const sent: DomainEvent[] = [];

    await replayStoredScans(store, {
      async publish(entry) {
        sent.push(entry);
      },
    });

    expect(sent.filter((entry) => entry.type === 'tip.scanned')).toHaveLength(0);
    expect(sent.filter((entry) => entry.type === 'event.published')).toHaveLength(1);
  });

  it('skips unreadable payloads', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const row = store.events[0]!;
    row.status = 'in_review';
    row.llmOutput = { choices: [{ message: { content: 'not json' } }] };

    const summary = await replayStoredScans(store);

    expect(summary).toMatchObject({ claimed: 1, skipped: 1, published: 0, review: 0 });
    expect(row.status).toBe('in_review');
  });

  it('ignores cancelled rows', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const row = store.events[0]!;
    row.status = 'cancelled';
    row.llmOutput = openAiScanOutput({
      contentVerdict: 'safe',
      possibleTags: [],
      possiblePublishers: [],
      possibleDuplicates: [],
      summary: 'Musik',
      language: 'sv',
      instructions: [],
      startsAt: null,
      endsAt: null,
      possibleVenueNames: [],
    });

    const summary = await replayStoredScans(store);

    expect(summary.claimed).toBe(0);
  });

  it('drops stale possibleDuplicate when replay output has none', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const publisher = store.linkPublisher({
      sourceId: source.id,
      organizerKey: event.organizerKeys[0]!,
      name: 'Foreningen',
      isTemporary: false,
      status: 'published',
    });
    await saveIncomingEvents(store, source, [event]);
    const row = store.events[0]!;
    row.status = 'in_review';
    row.meta = {
      ...row.meta,
      possibleDuplicate: {
        eventId: '33333333-3333-4333-8333-333333333399',
        title: 'Aldre konsert',
        startsAt: event.startsAt,
        refId: null,
        workerId: null,
        matchedOn: 'llm',
      },
    };
    row.llmOutput = {
      contentVerdict: 'safe',
      possibleTags: [],
      possiblePublishers: [{ publisherId: publisher.publisherId, rank: 95 }],
      possibleDuplicates: [],
      summary: 'Musik i Helsingehus',
      language: 'sv',
      instructions: [],
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      possibleVenueNames: [],
    };

    await replayStoredScans(store);

    expect(store.events[0]?.meta.possibleDuplicate).toBeUndefined();
  });

  it('replays Anthropic-style payloads', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const publisher = store.linkPublisher({
      sourceId: source.id,
      organizerKey: event.organizerKeys[0]!,
      name: 'Foreningen',
      isTemporary: false,
      status: 'published',
    });
    await saveIncomingEvents(store, source, [event]);
    const row = store.events[0]!;
    row.status = 'in_review';
    row.llmOutput = anthropicScanOutput({
      contentVerdict: 'safe',
      possibleTags: [],
      possiblePublishers: [{ publisherId: publisher.publisherId, rank: 95 }],
      possibleDuplicates: [],
      summary: 'Musik i Helsingehus',
      language: 'sv',
      instructions: [],
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      possibleVenueNames: [],
    });

    const summary = await replayStoredScans(store);

    expect(summary).toMatchObject({ claimed: 1, published: 1, skipped: 0 });
    expect(store.events[0]?.publisherId).toBe(publisher.publisherId);
  });

  it('replays only the requested --event row', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const publisher = store.linkPublisher({
      sourceId: source.id,
      organizerKey: event.organizerKeys[0]!,
      name: 'Foreningen',
      isTemporary: false,
      status: 'published',
    });
    await saveIncomingEvents(store, source, [
      event,
      { ...event, externalId: 'cbis:2', title: 'Marknad' },
    ]);
    const target = store.events.find((row) => row.title === 'Marknad')!;
    const untouched = store.events.find((row) => row.title === 'Konsert')!;
    target.status = 'in_review';
    untouched.status = 'in_review';
    target.llmOutput = {
      contentVerdict: 'safe',
      possibleTags: [],
      possiblePublishers: [{ publisherId: publisher.publisherId, rank: 95 }],
      possibleDuplicates: [],
      summary: 'Marknad i centrum',
      language: 'sv',
      instructions: [],
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      possibleVenueNames: [],
    };
    untouched.llmOutput = {
      contentVerdict: 'safe',
      possibleTags: [],
      possiblePublishers: [{ publisherId: publisher.publisherId, rank: 95 }],
      possibleDuplicates: [],
      summary: 'Musik i Helsingehus',
      language: 'sv',
      instructions: [],
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      possibleVenueNames: [],
    };

    const summary = await replayStoredScans(store, undefined, { eventId: target.id });

    expect(summary).toMatchObject({ claimed: 1, published: 1 });
    expect(store.events.find((row) => row.id === target.id)?.status).toBe('published');
    expect(store.events.find((row) => row.id === untouched.id)?.status).toBe('in_review');
  });

  it('supports dry-run without persisting status changes', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const publisher = store.linkPublisher({
      sourceId: source.id,
      organizerKey: event.organizerKeys[0]!,
      name: 'Foreningen',
      isTemporary: false,
      status: 'published',
    });
    await saveIncomingEvents(store, source, [event]);
    const row = store.events[0]!;
    row.status = 'in_review';
    row.llmOutput = {
      contentVerdict: 'safe',
      possibleTags: [],
      possiblePublishers: [{ publisherId: publisher.publisherId, rank: 95 }],
      possibleDuplicates: [],
      summary: 'Musik i Helsingehus',
      language: 'sv',
      instructions: [],
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      possibleVenueNames: [],
    };
    const sent: DomainEvent[] = [];

    const summary = await replayStoredScans(
      store,
      {
        async publish(entry) {
          sent.push(entry);
        },
      },
      { dryRun: true },
    );

    expect(summary).toMatchObject({ claimed: 1, published: 1, review: 0, dryRun: true });
    expect(store.events[0]?.status).toBe('in_review');
    expect(sent).toHaveLength(0);
  });
});
