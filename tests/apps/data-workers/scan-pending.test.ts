import type { DomainEvent } from '../../../packages/contracts/src/domain-events';
import { describe, expect, it } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { saveIncomingEvents } from '../../../apps/data-workers/src/persist';
import { parseScanSelection, scanPendingEvents } from '../../../apps/data-workers/src/scan-pending';
import {
  beginScanProgress,
  createScanProgress,
  finishScanProgress,
} from '../../../apps/data-workers/src/scan-progress';
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
  instructions: [] as string[],
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
  it('enqueues tip.scanned for an event a person tipped', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const eventId = store.events[0]!.id;
    const tipId = '11111111-1111-4111-8111-111111111111';
    store.tipLinks.set(eventId, tipId);
    const published: DomainEvent[] = [];
    const runner: PromptRunner = {
      id: 'tip',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
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
        }));
      },
    };
    await scanPendingEvents(store, runner, {
      async publish(entry) {
        published.push(entry);
      },
    });
    expect(published).toContainEqual({
      type: 'tip.scanned',
      tipId,
      eventId,
      status: 'in_review',
    });
  });

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
      lookupPublisher: async () => ({ ok: true, profile: null }),
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
    expect(store.events.every((row) => row.meta.instructions === undefined)).toBe(true);
    expect(
      store.events.every((row) => row.summary === 'Musik i Helsingehus' && row.language === 'sv'),
    ).toBe(true);
  });

  it('stores scan instructions on the event meta', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const runner: PromptRunner = {
      id: 'instructions',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
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
          instructions: [' Ta med matsäck ', ''],
        }));
      },
    };

    await scanPendingEvents(store, runner);

    expect(store.events[0]?.meta.instructions).toEqual(['Ta med matsäck']);
    expect(store.events[0]?.meta.import?.organizerKeys).toEqual(['kansli@example.com']);
  });

  it('leaves a failed event pending and finishes the rest of the batch', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    store.linkPublisher({
      sourceId: source.id,
      organizerKey: event.organizerKeys[0]!,
      name: 'Föreningen',
      isTemporary: false,
      status: 'published',
    });
    await saveIncomingEvents(store, source, [
      event,
      { ...event, externalId: 'cbis:2', title: 'Marknad' },
    ]);
    const runner: PromptRunner = {
      id: 'partial',
      lookupPublisher: async () => ({ ok: true, profile: null }),
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
                  status: 'published',
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

    expect(summary).toMatchObject({
      claimed: 2,
      published: 1,
      unavailable: 1,
      unavailable_timeout: 0,
    });
    const pending = store.events.filter((row) => row.status === 'pending_scan');
    const published = store.events.filter((row) => row.status === 'published');
    expect(pending).toHaveLength(1);
    expect(published).toHaveLength(1);
    expect(pending[0]?.publisherId ?? null).toBeNull();
  });

  it('counts a timed out chat inside unavailable', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const runner: PromptRunner = {
      id: 'timeout',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
          ok: false,
          eventId: item.eventId,
          reason: 'timeout',
        }));
      },
    };

    const summary = await scanPendingEvents(store, runner);

    expect(summary).toMatchObject({ claimed: 1, unavailable: 1, unavailable_timeout: 1 });
    expect(store.events[0]?.status).toBe('pending_scan');
  });

  it('counts a model failure once in the scan progress', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const progress = createScanProgress();
    const runner: PromptRunner = {
      id: 'timeout-progress',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        return batch.map((item): ScanOutcome => {
          beginScanProgress(progress);
          finishScanProgress(progress, false);
          return { ok: false, eventId: item.eventId, reason: 'timeout' };
        });
      },
    };

    await scanPendingEvents(store, runner, undefined, { progress });

    expect(progress).toEqual({ scanning: 0, done: 0, failed: 1 });
  });

  it('replaces tags the event already has', async () => {
    const store = createMemoryIngestStore();
    store.sources.push({ ...source, trust: 'review' });
    await store.upsertTags([
      { externalId: 'visit-soderhamn:1', name: 'Musik' },
      { externalId: 'visit-soderhamn:2', name: 'Teater' },
    ]);
    await saveIncomingEvents(store, { ...source, trust: 'review' }, [
      {
        ...event,
        tags: [{ externalId: 'visit-soderhamn:1', name: 'Musik' }],
      },
    ]);
    const previous = store.events[0]?.tagIds[0];
    const runner: PromptRunner = {
      id: 'retag',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
          ok: true,
          eventId: item.eventId,
          publisher: {
            kind: 'temporary',
            name: 'Föreningen',
            organizerKeys: item.organizer.keys,
          },
          duplicate: null,
          approved: true,
          tags: [{ externalId: 'visit-soderhamn:2', name: 'Teater' }],
          ...scanned,
        }));
      },
    };

    const summary = await scanPendingEvents(store, runner);

    expect(summary.review).toBe(1);
    expect(store.events[0]?.tagIds).not.toContain(previous);
    const replacement = await store.tagIdsForExternalIds(['visit-soderhamn:2']);
    expect(store.events[0]?.tagIds).toEqual(replacement);
  });

  it('keeps scanning the batch when applying one outcome throws', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [
      event,
      { ...event, externalId: 'cbis:2', title: 'Marknad' },
    ]);
    const failingId = store.events.find((row) => row.title === 'Konsert')!.id;
    const finish = store.finishImportedScan.bind(store);
    store.finishImportedScan = async (input) => {
      if (input.eventId === failingId) throw new Error('invalid input syntax for type uuid');
      return finish(input);
    };
    const progress = createScanProgress();
    const runner: PromptRunner = {
      id: 'throws',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        return batch.map((item): ScanOutcome => {
          beginScanProgress(progress);
          finishScanProgress(progress, true);
          return {
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
          };
        });
      },
    };

    const summary = await scanPendingEvents(store, runner, undefined, { progress });

    expect(summary).toMatchObject({ claimed: 2, review: 1, unavailable: 1 });
    expect(progress).toEqual({ scanning: 0, done: 1, failed: 1 });
    expect(store.events.find((row) => row.id === failingId)).toMatchObject({
      status: 'pending_scan',
      scanClaimedUntil: null,
    });
    expect(store.events.find((row) => row.title === 'Marknad')?.status).toBe('in_review');
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
      lookupPublisher: async () => ({ ok: true, profile: null }),
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
      meta: { possibleOccasionGroupId: 'cbis:concert', freeEntry: true },
    });
    const runner: PromptRunner = {
      id: 'occasion',
      lookupPublisher: async () => ({ ok: true, profile: null }),
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
      lookupPublisher: async () => ({ ok: true, profile: null }),
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

    const groupId = store.events.find((row) => row.title === 'Konsert')?.meta
      .possibleOccasionGroupId;
    expect(groupId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(store.events.find((row) => row.id === siblingId)?.meta.possibleOccasionGroupId).toBe(
      groupId,
    );
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
      lookupPublisher: async () => ({ ok: true, profile: null }),
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
      lookupPublisher: async () => ({ ok: true, profile: null }),
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

  it('creates a temporary publisher that shares an organizer key already stored for this source', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const existing = store.linkPublisher({
      sourceId: source.id,
      organizerKey: 'soderhamn.se',
      name: 'First',
      isTemporary: true,
    });
    await saveIncomingEvents(store, source, [
      {
        ...event,
        organizerKeys: ['other@example.com', 'soderhamn.se'],
        organizerName: 'Second',
      },
    ]);

    const summary = await scanPendingEvents(store, {
      id: 'shared-key',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
          ok: true,
          eventId: item.eventId,
          publisher: {
            kind: 'temporary',
            name: 'Second',
            organizerKeys: item.organizer.keys,
          },
          duplicate: null,
          approved: true,
          tags: [],
          ...scanned,
        }));
      },
    });

    expect(summary.review).toBe(1);
    expect(store.publishers).toHaveLength(2);
    expect(store.events[0]?.publisherId).not.toBe(existing.publisherId);
    const candidates = await store.listPublisherCandidates(source.id, ['soderhamn.se']);
    expect(new Set(candidates.map((row) => row.publisherId))).toEqual(
      new Set(store.publishers.map((publisher) => publisher.id)),
    );
  });

  it('remembers a shared organizer key on each publisher without duplicating it', async () => {
    const store = createMemoryIngestStore();
    const first = await store.createTemporaryPublisher({
      sourceId: source.id,
      organizerKeys: ['soderhamn.se', 'soderhamn.se'],
      name: 'First',
    });
    const second = await store.createTemporaryPublisher({
      sourceId: source.id,
      organizerKeys: ['other@example.com'],
      name: 'Second',
    });
    await store.rememberOrganizerKeys(source.id, second.publisherId, ['soderhamn.se']);
    await store.rememberOrganizerKeys(source.id, second.publisherId, ['soderhamn.se']);

    const candidates = await store.listPublisherCandidates(source.id, ['soderhamn.se']);
    expect(new Set(candidates.map((row) => row.publisherId))).toEqual(
      new Set([first.publisherId, second.publisherId]),
    );
    const secondKeys = candidates
      .filter((row) => row.publisherId === second.publisherId)
      .flatMap((row) => row.organizerKeys)
      .filter((key) => key === 'soderhamn.se');
    expect(secondKeys).toEqual(['soderhamn.se']);
  });

  it('creates a temporary publisher without looking it up', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [
      event,
      { ...event, externalId: 'cbis:2', title: 'Marknad' },
    ]);
    let lookups = 0;
    const runner: PromptRunner = {
      id: 'lookup',
      lookupPublisher: async () => {
        lookups += 1;
        return { ok: true, profile: null };
      },
      async scan(batch) {
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

    expect(summary).toMatchObject({ claimed: 2, review: 2 });
    expect(lookups).toBe(0);
    expect(store.publishers).toHaveLength(1);
    expect(store.publishers[0]?.status).toBe('pending_scan');
    expect(store.events.every((row) => row.publisherId === store.publishers[0]?.id)).toBe(true);
  });

  it('does not look up a publisher that already exists', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const linked = store.linkPublisher({
      sourceId: source.id,
      organizerKey: event.organizerKeys[0]!,
      name: 'Föreningen',
      isTemporary: false,
      status: 'published',
    });
    await saveIncomingEvents(store, source, [event]);
    let lookups = 0;
    const runner: PromptRunner = {
      id: 'existing',
      lookupPublisher: async () => {
        lookups += 1;
        return { ok: true, profile: null };
      },
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
          ok: true,
          eventId: item.eventId,
          publisher: {
            kind: 'existing',
            publisherId: linked.publisherId,
            isTemporary: false,
            status: 'published',
            importNotificationPlan: null,
          },
          duplicate: null,
          approved: true,
          tags: [],
          ...scanned,
        }));
      },
    };

    const summary = await scanPendingEvents(store, runner);

    expect(summary.published).toBe(1);
    expect(lookups).toBe(0);
  });

  it('writes the scan dates when the event has none', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const { startsAt: _startsAt, endsAt: _endsAt, ...undated } = event;
    await saveIncomingEvents(store, source, [undated]);
    expect(store.events[0]?.startsAt).toBeNull();
    expect(store.events[0]?.endsAt).toBeNull();
    const runner: PromptRunner = {
      id: 'dates',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        expect(batch[0]?.startsAt).toBe('');
        expect(batch[0]?.endsAt).toBe('');
        return batch.map((item): ScanOutcome => ({
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
          startsAt: '2026-11-14T19:00:00+01:00',
          endsAt: '2026-11-14T21:00:00+01:00',
        }));
      },
    };

    await scanPendingEvents(store, runner);

    expect(store.events[0]?.startsAt?.toISOString()).toBe('2026-11-14T18:00:00.000Z');
    expect(store.events[0]?.endsAt?.toISOString()).toBe('2026-11-14T20:00:00.000Z');
    expect(store.events[0]?.occasions).toEqual([
      {
        startsAt: new Date('2026-11-14T18:00:00.000Z'),
        endsAt: new Date('2026-11-14T20:00:00.000Z'),
        venueName: 'Helsingehus',
      },
    ]);
  });

  it('adds each showing from the description and skips a repeated time', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const { startsAt: _startsAt, endsAt: _endsAt, ...undated } = event;
    await saveIncomingEvents(store, source, [undated]);
    const runner: PromptRunner = {
      id: 'occasions',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
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
          possibleOccasions: [
            {
              startsAt: '2026-11-14T19:00:00+01:00',
              endsAt: '2026-11-14T21:00:00+01:00',
              venueName: 'Bygdegården',
            },
            {
              startsAt: '2026-11-21T19:00:00+01:00',
              endsAt: '2026-11-21T20:30:00+01:00',
              venueName: 'Bygdegården',
            },
            {
              startsAt: '2026-11-14T19:00:00+01:00',
              endsAt: '2026-11-14T21:00:00+01:00',
              venueName: 'Again',
            },
          ],
        }));
      },
    };

    await scanPendingEvents(store, runner);

    expect(store.events[0]?.startsAt?.toISOString()).toBe('2026-11-14T18:00:00.000Z');
    expect(
      store.events[0]?.occasions.map((occasion) => ({
        startsAt: occasion.startsAt.toISOString(),
        endsAt: occasion.endsAt.toISOString(),
        venueName: occasion.venueName,
      })),
    ).toEqual([
      {
        startsAt: '2026-11-14T18:00:00.000Z',
        endsAt: '2026-11-14T20:00:00.000Z',
        venueName: 'Bygdegården',
      },
      {
        startsAt: '2026-11-21T18:00:00.000Z',
        endsAt: '2026-11-21T19:30:00.000Z',
        venueName: 'Bygdegården',
      },
    ]);
  });

  it('leaves stored dates when the event already has them', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const runner: PromptRunner = {
      id: 'keep-dates',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
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
          startsAt: '2026-11-14T19:00:00+01:00',
          endsAt: '2026-11-14T21:00:00+01:00',
        }));
      },
    };

    await scanPendingEvents(store, runner);

    expect(store.events[0]?.startsAt?.toISOString()).toBe('2027-06-01T18:00:00.000Z');
    expect(store.events[0]?.endsAt?.toISOString()).toBe('2027-06-01T21:00:00.000Z');
    expect(store.events[0]?.occasions.map((occasion) => occasion.startsAt.toISOString())).toEqual([
      '2027-06-01T18:00:00.000Z',
      '2026-11-14T18:00:00.000Z',
    ]);
  });

  it('leaves the dates empty when the scan finds only one', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const { startsAt: _startsAt, endsAt: _endsAt, ...undated } = event;
    await saveIncomingEvents(store, source, [undated]);
    const runner: PromptRunner = {
      id: 'one-date',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
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
          startsAt: '2026-11-14T19:00:00+01:00',
          endsAt: null,
        }));
      },
    };

    await scanPendingEvents(store, runner);

    expect(store.events[0]?.startsAt).toBeNull();
    expect(store.events[0]?.endsAt).toBeNull();
    expect(store.events[0]?.status).toBe('in_review');
  });

  it('writes a page point only when the event has none, and keeps an imported address', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [
      {
        ...event,
        location: undefined,
        links: [{ type: 'tickets' as const, url: 'https://tickets.example/show' }],
        meta: {
          address: { address: 'Köpmangatan 14', city: 'Delsbo', country: 'Sweden' as const },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'page',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        expect(batch[0]?.pageLinks).toEqual([
          { type: 'tickets', url: 'https://tickets.example/show' },
        ]);
        expect(batch[0]?.location).toEqual({ lat: 61.8, lng: 16.55 });
        return batch.map((item): ScanOutcome => ({
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
          address: { address: 'Annan gata 1', city: 'Hudiksvall', country: 'Sweden' },
        }));
      },
    };

    await scanPendingEvents(store, runner, undefined, {
      fetch: async () =>
        Response.json({
          features: [
            { geometry: { coordinates: [16.55, 61.8] }, properties: { countrycode: 'SE' } },
          ],
        }),
    });

    expect(store.events[0]?.location).toEqual({ lat: 61.8, lng: 16.55 });
    expect(store.events[0]?.meta.address).toEqual({
      address: 'Köpmangatan 14',
      city: 'Delsbo',
      country: 'Sweden',
      location: { lat: 61.8, lng: 16.55 },
    });
  });

  it('uses a point already stored on the address before nearby tools run', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const point = { lat: 61.3025885, lng: 17.0558599 };
    await saveIncomingEvents(store, source, [
      {
        ...event,
        location: undefined,
        meta: {
          address: {
            address: 'Köpmangatan 11',
            city: 'Söderhamn',
            country: 'Sweden' as const,
            location: point,
          },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'address-point',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        expect(batch[0]?.location).toEqual(point);
        return batch.map((item): ScanOutcome => ({
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
        }));
      },
    };

    await scanPendingEvents(store, runner, undefined, {
      fetch: async () => {
        throw new Error('address point should not be geocoded again');
      },
    });

    expect(store.events[0]?.location).toEqual(point);
  });

  it('leaves an existing point and stores a page address when the import had none', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const runner: PromptRunner = {
      id: 'page-address',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
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
          location: { lat: 1, lng: 2 },
          address: { address: 'Storgatan 1', city: 'Söderhamn', country: 'Sweden' },
        }));
      },
    };

    await scanPendingEvents(store, runner);

    expect(store.events[0]?.location).toEqual({ lat: 61.3, lng: 17.07 });
    expect(store.events[0]?.meta.address).toEqual({
      address: 'Storgatan 1',
      city: 'Söderhamn',
      country: 'Sweden',
    });
  });

  it('geocodes the model address when the import stored neither a point nor an address', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const { location: _location, ...withoutPoint } = event;
    await saveIncomingEvents(store, source, [withoutPoint]);
    const runner: PromptRunner = {
      id: 'model-address',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
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
          address: { address: 'Köpmangatan 14', city: 'Delsbo', country: 'Sweden' },
        }));
      },
    };

    await scanPendingEvents(store, runner, undefined, {
      fetch: async () =>
        Response.json({
          features: [
            { geometry: { coordinates: [16.55, 61.8] }, properties: { countrycode: 'SE' } },
          ],
        }),
    });

    expect(store.events[0]?.location).toEqual({ lat: 61.8, lng: 16.55 });
    expect(store.events[0]?.meta.address).toEqual({
      address: 'Köpmangatan 14',
      city: 'Delsbo',
      country: 'Sweden',
      location: { lat: 61.8, lng: 16.55 },
    });
  });

  it('keeps a scan point when a later import has no location', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const row = store.events[0]!;
    row.location = { lat: 61.8, lng: 16.55 };
    row.meta = {
      ...row.meta,
      address: {
        address: 'Köpmangatan 14',
        city: 'Delsbo',
        country: 'Sweden',
        location: { lat: 61.8, lng: 16.55 },
      },
    };
    row.status = 'pending_scan';
    const { location: _location, ...withoutPoint } = event;

    const saved = await store.updateImported(row.id, {
      sourceId: source.id,
      externalId: event.externalId,
      contentHash: 'again',
      publisherId: null,
      status: 'pending_scan',
      event: withoutPoint,
      endsAt: event.endsAt!,
      tagIds: [],
      refId: event.externalId,
      workerId: source.slug,
    });

    expect(saved).toBe(true);
    expect(row.location).toEqual({ lat: 61.8, lng: 16.55 });
    expect(row.meta.address?.location).toEqual({ lat: 61.8, lng: 16.55 });
  });

  it('writes a model venue ahead of the imported arena and venue', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const { venueName: _venue, ...withoutVenue } = event;
    await saveIncomingEvents(store, source, [
      event,
      {
        ...event,
        externalId: 'cbis:arena',
        title: 'Arena',
        venueName: 'Hudiksvall',
        arenaName: 'Café Carlsson',
      },
      { ...event, externalId: 'cbis:city', title: 'Stad', venueName: 'Hudiksvall' },
      { ...withoutVenue, externalId: 'cbis:none', title: 'Tom' },
    ]);
    const locations: string[] = [];
    const runner: PromptRunner = {
      id: 'venue',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        locations.push(...batch.map((item) => `${item.title}:${item.venue ?? ''}`));
        return batch.map((item): ScanOutcome => ({
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
          possibleVenueNames:
            item.title === 'Konsert'
              ? [
                  { name: 'Folkets hus', rank: 81 },
                  { name: 'Svea Bio', rank: 96 },
                ]
              : [{ name: 'Torget', rank: 80 }],
        }));
      },
    };

    await scanPendingEvents(store, runner);

    expect(locations).toEqual([
      'Konsert:Helsingehus',
      'Arena:Café Carlsson',
      'Stad:Hudiksvall',
      'Tom:',
    ]);
    const venueOf = (externalId: string) => {
      const eventId = store.refs.find((item) => item.externalId === externalId)?.eventId;
      return store.events.find((item) => item.id === eventId)?.venueName;
    };
    expect(venueOf('cbis:1')).toBe('Svea Bio');
    expect(venueOf('cbis:arena')).toBe('Café Carlsson');
    expect(venueOf('cbis:city')).toBe('Hudiksvall');
    expect(venueOf('cbis:none')).toBe('Torget');
  });

  it('writes a rank above 50 when the imported venue is only the city', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [
      {
        ...event,
        externalId: 'cbis:city-only',
        title: 'Requiem',
        venueName: 'Söderhamn',
        meta: { address: { city: 'Söderhamn' } },
      },
    ]);
    let rank = 40;
    const runner: PromptRunner = {
      id: 'city-venue',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        return batch.map((item): ScanOutcome => ({
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
          possibleVenueNames: [{ name: 'Söderhamns Teater', rank }],
        }));
      },
    };

    await scanPendingEvents(store, runner);

    const eventId = store.refs.find((item) => item.externalId === 'cbis:city-only')?.eventId;
    const saved = store.events.find((item) => item.id === eventId);
    expect(saved?.venueName).toBe('Söderhamn');
    expect(saved?.occasions[0]?.venueName).toBe('Söderhamn');

    saved!.status = 'pending_scan';
    saved!.scanClaimedUntil = null;
    rank = 55;
    await scanPendingEvents(store, runner, undefined, { eventId });

    expect(saved?.venueName).toBe('Söderhamns Teater');
    expect(saved?.occasions[0]?.venueName).toBe('Söderhamns Teater');
  });
});
