import { describe, expect, it } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { saveIncomingEvents } from '../../../apps/data-workers/src/persist';
import { parseScanSelection, scanPendingEvents } from '../../../apps/data-workers/src/scan-pending';
import type { SourceRecord } from '../../../apps/data-workers/src/store';
import {
  createOllamaPromptRunner,
  type PromptRunner,
  type ScanInput,
  type ScanOutcome,
} from '../../../apps/data-workers/src/prompt-runners';

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
  summary: 'Musik i Helsingehus',
  language: 'sv',
};

describe('parseScanSelection', () => {
  it('accepts one event id or a limit', () => {
    expect(parseScanSelection({ eventId: '33333333-3333-4333-8333-333333333301' })).toEqual({
      ok: true,
      eventId: '33333333-3333-4333-8333-333333333301',
    });
    expect(parseScanSelection({ limit: '1' })).toEqual({ ok: true, limit: 1 });
  });

  it('rejects a missing id and a limit of zero', () => {
    expect(parseScanSelection({ eventId: '' }).ok).toBe(false);
    expect(parseScanSelection({ eventId: 'not-an-id' }).ok).toBe(false);
    expect(parseScanSelection({ limit: '0' }).ok).toBe(false);
  });
});

describe('scanPendingEvents', () => {
  it('passes the claimed batch to the runner in one call', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [
      event,
      { ...event, externalId: 'cbis:2', title: 'Marknad' },
    ]);
    const batches: ScanInput[][] = [];
    const runner: PromptRunner = {
      id: 'batch',
      async scan(batch) {
        batches.push(batch);
        return batch.map((item): ScanOutcome => ({
          ok: true,
          eventId: item.eventId,
          publisher: {
            kind: 'temporary',
            name: item.organizer.name ?? 'Tillfällig',
            organizerKeys: item.organizer.keys,
          },
          duplicate: null,
          approved: true,
          tags: [],
          ...scanned,
        }));
      },
    };

    const summary = await scanPendingEvents(store, runner);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((item) => item.title).sort()).toEqual(['Konsert', 'Marknad']);
    expect(summary).toMatchObject({ claimed: 2, review: 2, published: 0, unavailable: 0 });
    expect(store.events.every((row) => row.status === 'in_review')).toBe(true);
    expect(
      store.events.every((row) => row.summary === 'Musik i Helsingehus' && row.language === 'sv'),
    ).toBe(true);
  });

  it('leaves a failed event pending and finishes the rest of the batch', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    store.linkPublisher({
      sourceId: source.id,
      organizerKey: event.organizerKeys[0]!,
      name: 'Föreningen',
      isTemporary: false,
      verified: true,
    });
    await saveIncomingEvents(store, source, [
      event,
      { ...event, externalId: 'cbis:2', title: 'Marknad' },
    ]);
    const runner: PromptRunner = {
      id: 'partial',
      async scan(batch) {
        return batch.map((item, index): ScanOutcome =>
          index === 0
            ? { ok: false, eventId: item.eventId, reason: 'unavailable' }
            : {
                ok: true,
                eventId: item.eventId,
                publisher: {
                  kind: 'existing',
                  publisherId: store.publishers[0]!.id,
                  isTemporary: false,
                  verified: true,
                  importNotificationPlan: null,
                },
                duplicate: null,
                approved: true,
                tags: [],
                ...scanned,
              },
        );
      },
    };

    const summary = await scanPendingEvents(store, runner);

    expect(summary).toMatchObject({ claimed: 2, published: 1, unavailable: 1 });
    const pending = store.events.filter((row) => row.status === 'pending_scan');
    const published = store.events.filter((row) => row.status === 'published');
    expect(pending).toHaveLength(1);
    expect(published).toHaveLength(1);
    expect(pending[0]?.publisherId ?? null).toBeNull();
  });

  it('does not call the model when the event already has tags', async () => {
    const store = createMemoryIngestStore();
    store.sources.push({ ...source, trust: 'review' });
    await saveIncomingEvents(store, { ...source, trust: 'review' }, [
      {
        ...event,
        tags: [{ externalId: 'visit-soderhamn:1', name: 'Musik' }],
      },
    ]);
    let calls = 0;
    const summary = await scanPendingEvents(
      store,
      createOllamaPromptRunner(store, {
        fetch: async () => {
          calls += 1;
          return new Response('down', { status: 503 });
        },
      }),
    );

    expect(calls).toBe(0);
    expect(summary.review).toBe(1);
    expect(store.events[0]?.status).toBe('in_review');
  });

  it('keeps an untagged event pending when the model is unavailable', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await store.upsertTags([{ externalId: 'visit-soderhamn:1', name: 'Musik' }]);
    await saveIncomingEvents(store, source, [event]);
    const summary = await scanPendingEvents(
      store,
      createOllamaPromptRunner(store, {
        fetch: async () => new Response('down', { status: 503 }),
      }),
    );

    expect(summary.unavailable).toBe(1);
    expect(store.events[0]).toMatchObject({ status: 'pending_scan', publisherId: null });
  });

  it('does not clear a publisher when a pending refresh loses to a finished scan', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const row = store.events[0]!;
    row.status = 'in_review';
    row.publisherId = '33333333-3333-4333-8333-333333333399';
    const saved = await store.updateImported(row.id, {
      sourceId: source.id,
      externalId: event.externalId,
      contentHash: 'changed',
      publisherId: null,
      status: 'pending_scan',
      event: { ...event, title: 'Konsert igen' },
      endsAt: event.endsAt!,
      tagIds: [],
      refId: event.externalId,
      workerId: source.slug,
    });

    expect(saved).toBe(false);
    expect(row.publisherId).toBe('33333333-3333-4333-8333-333333333399');
    expect(row.title).toBe('Konsert');
  });

  it('does not finish a scan after a newer claim takes the row', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const [claimed] = await store.claimPendingScans(1, 60_000);
    store.events[0]!.scanClaimedUntil = new Date(Date.now() + 120_000);
    const saved = await store.finishImportedScan({
      eventId: claimed!.eventId,
      publisherId: '33333333-3333-4333-8333-333333333399',
      status: 'in_review',
      meta: claimed!.meta,
      tagIds: [],
      contentVerdict: 'unknown',
      llmOutput: {},
      summary: null,
      language: 'sv',
      claimedUntil: claimed!.claimedUntil,
    });

    expect(saved).toBe(false);
    expect(store.events[0]).toMatchObject({ status: 'pending_scan', publisherId: null });
  });

  it('scans only the event id that was asked for', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [
      event,
      { ...event, externalId: 'cbis:2', title: 'Marknad' },
    ]);
    const target = store.events.find((row) => row.title === 'Marknad')!;
    const runner: PromptRunner = {
      id: 'one',
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
          ok: true,
          eventId: item.eventId,
          publisher: {
            kind: 'temporary',
            name: 'Tillfällig',
            organizerKeys: item.organizer.keys,
          },
          duplicate: null,
          approved: true,
          tags: [],
          ...scanned,
        }));
      },
    };

    const summary = await scanPendingEvents(store, runner, undefined, { eventId: target.id });

    expect(summary).toMatchObject({ claimed: 1, review: 1 });
    expect(store.events.find((row) => row.title === 'Marknad')?.status).toBe('in_review');
    expect(store.events.find((row) => row.title === 'Konsert')?.status).toBe('pending_scan');
  });

  it('stores one occasion group on the scanned event and the matching duplicate', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const siblingId = '33333333-3333-4333-8333-333333333399';
    store.events.push({
      id: siblingId,
      publisherId: null,
      title: 'Konsert nästa dag',
      description: null,
      status: 'published',
      origin: 'imported',
      sourceUrl: 'https://example.com/nasta',
      startsAt: new Date('2027-06-02T18:00:00.000Z'),
      endsAt: new Date('2027-06-02T21:00:00.000Z'),
      venueName: null,
      tagIds: [],
      meta: { occasionGroupId: 'cbis:concert', freeEntry: true },
    });
    const runner: PromptRunner = {
      id: 'occasion',
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
          ok: true,
          eventId: item.eventId,
          publisher: {
            kind: 'temporary',
            name: 'Tillfällig',
            organizerKeys: item.organizer.keys,
          },
          duplicate: null,
          occasionMatches: [{ eventId: siblingId, occasionRank: 95 }],
          approved: true,
          tags: [],
          ...scanned,
        }));
      },
    };

    await scanPendingEvents(store, runner);

    const scannedEvent = store.events.find((row) => row.title === 'Konsert');
    const sibling = store.events.find((row) => row.id === siblingId);
    expect(scannedEvent?.meta.possibleOccasionGroupId).toBe('cbis:concert');
    expect(sibling?.meta.possibleOccasionGroupId).toBe('cbis:concert');
    expect(sibling?.meta.occasionGroupId).toBe('cbis:concert');
    expect(sibling?.meta.freeEntry).toBe(true);
  });

  it('creates an occasion group id when none is stored yet', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const siblingId = '33333333-3333-4333-8333-333333333398';
    store.events.push({
      id: siblingId,
      publisherId: null,
      title: 'Konsert nästa dag',
      description: null,
      status: 'published',
      origin: 'imported',
      sourceUrl: 'https://example.com/nasta',
      startsAt: new Date('2027-06-02T18:00:00.000Z'),
      endsAt: new Date('2027-06-02T21:00:00.000Z'),
      venueName: null,
      tagIds: [],
      meta: {},
    });
    const runner: PromptRunner = {
      id: 'occasion-new',
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
          ok: true,
          eventId: item.eventId,
          publisher: {
            kind: 'temporary',
            name: 'Tillfällig',
            organizerKeys: item.organizer.keys,
          },
          duplicate: null,
          occasionMatches: [
            { eventId: siblingId, occasionRank: 95 },
            { eventId: 'not-an-id', occasionRank: 99 },
          ],
          approved: true,
          tags: [],
          ...scanned,
        }));
      },
    };

    await scanPendingEvents(store, runner);

    const groupId = store.events.find((row) => row.title === 'Konsert')?.meta.possibleOccasionGroupId;
    expect(groupId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(store.events.find((row) => row.id === siblingId)?.meta.possibleOccasionGroupId).toBe(groupId);
  });

  it('keeps the occasion group when the matched event is scanned later in the batch', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [
      event,
      { ...event, externalId: 'cbis:2', title: 'Marknad' },
    ]);
    const runner: PromptRunner = {
      id: 'pair',
      async scan(batch) {
        const first = batch.find((item) => item.title === 'Konsert')!;
        const second = batch.find((item) => item.title === 'Marknad')!;
        const outcome = (item: ScanInput, matchId: string | null): ScanOutcome => ({
          ok: true,
          eventId: item.eventId,
          publisher: {
            kind: 'temporary',
            name: 'Tillfällig',
            organizerKeys: item.organizer.keys,
          },
          duplicate: null,
          ...(matchId ? { occasionMatches: [{ eventId: matchId, occasionRank: 95 }] } : {}),
          approved: true,
          tags: [],
          ...scanned,
        });
        return [outcome(first, second.eventId), outcome(second, null)];
      },
    };

    await scanPendingEvents(store, runner);

    const konsert = store.events.find((row) => row.title === 'Konsert');
    const marknad = store.events.find((row) => row.title === 'Marknad');
    expect(konsert?.meta.possibleOccasionGroupId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(marknad?.meta.possibleOccasionGroupId).toBe(konsert?.meta.possibleOccasionGroupId);
  });

  it('reuses the first occasion group when both events name each other', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [
      event,
      { ...event, externalId: 'cbis:2', title: 'Marknad' },
    ]);
    const runner: PromptRunner = {
      id: 'mutual',
      async scan(batch) {
        const first = batch.find((item) => item.title === 'Konsert')!;
        const second = batch.find((item) => item.title === 'Marknad')!;
        const outcome = (item: ScanInput, matchId: string): ScanOutcome => ({
          ok: true,
          eventId: item.eventId,
          publisher: {
            kind: 'temporary',
            name: 'Tillfällig',
            organizerKeys: item.organizer.keys,
          },
          duplicate: null,
          occasionMatches: [{ eventId: matchId, occasionRank: 95 }],
          approved: true,
          tags: [],
          ...scanned,
        });
        return [outcome(first, second.eventId), outcome(second, first.eventId)];
      },
    };

    await scanPendingEvents(store, runner);

    const konsert = store.events.find((row) => row.title === 'Konsert');
    const marknad = store.events.find((row) => row.title === 'Marknad');
    expect(konsert?.meta.possibleOccasionGroupId).toBeTruthy();
    expect(marknad?.meta.possibleOccasionGroupId).toBe(konsert?.meta.possibleOccasionGroupId);
  });
});
