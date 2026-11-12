import type { DomainEvent } from '../../../packages/contracts/src/domain-events';
import { describe, expect, it } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { saveIncomingEvents } from '../../../apps/data-workers/src/persist';
import { addressCacheKey } from '../../../apps/data-workers/src/page-place';
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
  it('uses a stored venue point and does not geocode', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const venue = await store.saveVenue({
      name: 'Söderhamns Teater',
      city: 'Söderhamn',
      nameKey: 'söderhamns teater',
      cityKey: 'söderhamn',
      location: { lat: 61.304, lng: 17.062 },
    });
    const { location: _location, ...withoutPoint } = event;
    await saveIncomingEvents(store, source, [
      {
        ...withoutPoint,
        externalId: 'venue-1',
        venueName: 'Söderhamns Teater',
        meta: { address: { city: 'Söderhamn', country: 'Sweden' } },
      },
    ]);
    const calls: string[] = [];
    const runner: PromptRunner = {
      id: 'venue',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        expect(batch[0]?.location).toEqual({ lat: 61.304, lng: 17.062 });
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
      fetch: async (input) => {
        calls.push(String(input));
        throw new Error('geocoder should not be called');
      },
    });
    expect(calls).toEqual([]);
    expect(store.events[0]?.location).toEqual({ lat: 61.304, lng: 17.062 });
    expect(store.events[0]?.occasions[0]?.venueId).toBe(venue.id);
  });

  it('geocodes a new venue and stores it', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const { location: _location, ...withoutPoint } = event;
    await saveIncomingEvents(store, source, [
      {
        ...withoutPoint,
        externalId: 'venue-2',
        venueName: 'Staffansgården',
        meta: {
          address: {
            address: 'Staffansvägen 1',
            zipCode: '82632',
            city: 'Söderhamn',
            country: 'Sweden',
          },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'venue-new',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        expect(batch[0]?.location).toBeUndefined();
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
          address: {
            address: 'Staffansvägen 1',
            zipCode: '82632',
            city: 'Söderhamn',
            country: 'Sweden',
            rank: 40,
          },
        }));
      },
    };
    await scanPendingEvents(store, runner, undefined, {
      fetch: async (input) => {
        const query = new URL(String(input)).searchParams.get('q') ?? '';
        if (query.startsWith('Staffansvägen')) {
          return Response.json({
            features: [
              {
                geometry: { coordinates: [17.07, 61.31] },
                properties: {
                  countrycode: 'SE',
                  housenumber: '1',
                  street: 'Staffansvägen',
                  city: 'Söderhamn',
                },
              },
            ],
          });
        }
        return Response.json({ features: [] });
      },
    });
    const stored = await store.findVenue('staffansgården', 'söderhamn');
    expect(stored?.location).toEqual({ lat: 61.31, lng: 17.07 });
    expect(stored?.address).toBe('Staffansvägen 1');
    expect(stored?.zipCode).toBe('82632');
    expect(store.events[0]?.location).toEqual({ lat: 61.31, lng: 17.07 });
    expect(store.events[0]?.occasions[0]?.venueId).toBe(stored?.id);
  });

  it('writes the street onto a venue that was saved without one', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const point = { lat: 61.23, lng: 16.56 };
    await store.saveVenue({
      name: 'Biografen Kilafors',
      city: 'Kilafors',
      nameKey: 'biografen kilafors',
      cityKey: 'kilafors',
      location: point,
    });
    await saveIncomingEvents(store, source, [
      {
        ...event,
        externalId: 'cinema',
        location: point,
        venueName: 'Biografen Kilafors',
        meta: {
          address: {
            address: 'Biografen Kilafors, Stationsgatan Kilafors',
            zipCode: '82330',
            city: 'Kilafors',
            country: 'Sweden' as const,
            location: point,
          },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'venue-street',
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
    await scanPendingEvents(store, runner, undefined, {
      fetch: async () => {
        throw new Error('geocoder should not be called');
      },
    });
    const stored = await store.findVenue('biografen kilafors', 'kilafors');
    expect(stored?.address).toBe('Biografen Kilafors, Stationsgatan Kilafors');
    expect(stored?.zipCode).toBe('82330');
    expect(stored?.location).toEqual(point);
  });

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
                  importNotifyOnPublish: false,
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
            importNotifyOnPublish: false,
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

    await scanPendingEvents(store, runner, undefined, {
      fetch: async () => Response.json({ features: [] }),
    });

    expect(store.events[0]?.startsAt?.toISOString()).toBe('2026-11-14T18:00:00.000Z');
    expect(store.events[0]?.endsAt?.toISOString()).toBe('2026-11-14T20:00:00.000Z');
    expect(store.events[0]?.occasions[0]).toMatchObject({
      startsAt: new Date('2026-11-14T18:00:00.000Z'),
      endsAt: new Date('2026-11-14T20:00:00.000Z'),
      venueName: 'Helsingehus',
    });
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
        expect(batch[0]?.location).toBeUndefined();
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
          address: { address: 'Köpmangatan 14', city: 'Delsbo', country: 'Sweden', rank: 40 },
        }));
      },
    };

    await scanPendingEvents(store, runner, undefined, {
      fetch: async () =>
        Response.json({
          features: [
            {
              geometry: { coordinates: [16.55, 61.8] },
              properties: {
                countrycode: 'SE',
                housenumber: '14',
                street: 'Köpmangatan',
                city: 'Delsbo',
              },
            },
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

  it('looks up a street address when the stored point is only the town', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const town = { lat: 61.2299391, lng: 16.5635885 };
    const found = { lat: 61.230057, lng: 16.565837 };
    await store.saveKnownCity({ name: 'Kilafors', cityKey: 'kilafors', location: town });
    await saveIncomingEvents(store, source, [
      {
        ...event,
        location: town,
        meta: {
          address: {
            address: 'Biografen Kilafors, Stationsgatan Kilafors',
            city: 'Kilafors',
            country: 'Sweden' as const,
            location: town,
          },
        },
      },
    ]);
    const queries: string[] = [];
    const runner: PromptRunner = {
      id: 'town-point',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        expect(batch[0]?.location).toEqual(town);
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

    const previousKey = process.env.GOOGLE_MAPS_API_KEY;
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    try {
      await scanPendingEvents(store, runner, undefined, {
        fetch: async (input) => {
          queries.push(new URL(String(input)).searchParams.get('address') ?? '');
          return Response.json({
            status: 'OK',
            results: [
              {
                formatted_address: 'Stationsgatan 11, 823 30 Kilafors, Sverige',
                address_components: [
                  { long_name: '11', types: ['street_number'] },
                  { long_name: 'Stationsgatan', types: ['route'] },
                  { long_name: 'Kilafors', types: ['postal_town'] },
                  { long_name: 'Sweden', short_name: 'SE', types: ['country'] },
                ],
                geometry: {
                  location: found,
                  location_type: 'ROOFTOP',
                },
              },
            ],
          });
        },
      });
    } finally {
      if (previousKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
      else process.env.GOOGLE_MAPS_API_KEY = previousKey;
    }

    expect(queries[0]).toContain('Stationsgatan Kilafors');
    expect(store.events[0]?.location).toEqual(found);
    expect(store.events[0]?.occasions[0]?.location).toEqual(found);
    expect(store.events[0]?.meta.address?.location).toEqual(found);
  });

  it('uses a stored venue the model ranks over 90 and does not geocode', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const town = { lat: 61.2299391, lng: 16.5635885 };
    const cinema = { lat: 61.230057, lng: 16.565837 };
    await store.saveKnownCity({ name: 'Kilafors', cityKey: 'kilafors', location: town });
    const venue = await store.saveVenue({
      name: 'Biografen Kilafors',
      city: 'Kilafors',
      nameKey: 'biografen kilafors',
      cityKey: 'kilafors',
      location: cinema,
    });
    await saveIncomingEvents(store, source, [
      {
        ...event,
        location: town,
        venueName: 'Stationsgatan Kilafors',
        meta: {
          address: {
            address: 'Biografen Kilafors, Stationsgatan Kilafors',
            city: 'Kilafors',
            country: 'Sweden' as const,
            location: town,
          },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'venue-match',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        expect(batch[0]?.location).toEqual(town);
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
          possibleVenues: [{ venueId: venue.id, rank: 95 }],
        }));
      },
    };
    await scanPendingEvents(store, runner, undefined, {
      fetch: async () => {
        throw new Error('geocoder should not be called');
      },
    });
    expect(store.events[0]?.location).toEqual(cinema);
    expect(store.events[0]?.occasions[0]?.location).toEqual(cinema);
    expect(store.events[0]?.occasions[0]?.venueId).toBe(venue.id);
    expect(store.events[0]?.occasions[0]?.venueName).toBe('Biografen Kilafors');
  });

  it('does not geocode a street when a rank over 90 venue is found from the town', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const town = { lat: 61.2299391, lng: 16.5635885 };
    const cinema = { lat: 61.230057, lng: 16.565837 };
    await store.saveKnownCity({ name: 'Kilafors', cityKey: 'kilafors', location: town });
    const venue = await store.saveVenue({
      name: 'Biografen Kilafors',
      city: 'Kilafors',
      nameKey: 'biografen kilafors',
      cityKey: 'kilafors',
      location: cinema,
    });
    const { location: _location, ...withoutPoint } = event;
    await saveIncomingEvents(store, source, [
      {
        ...withoutPoint,
        externalId: 'no-point',
        venueName: 'Stationsgatan Kilafors',
        meta: {
          address: {
            address: 'Biografen Kilafors, Stationsgatan Kilafors',
            city: 'Kilafors',
            country: 'Sweden' as const,
          },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'venue-before-google',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        expect(batch[0]?.location).toBeUndefined();
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
          possibleVenues: [{ venueId: venue.id, rank: 95 }],
        }));
      },
    };
    await scanPendingEvents(store, runner, undefined, {
      fetch: async () => {
        throw new Error('geocoder should not be called');
      },
    });
    expect(store.events[0]?.location).toEqual(cinema);
    expect(store.events[0]?.occasions[0]?.location).toEqual(cinema);
  });

  it('looks up an address once when Google keeps no point', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const { location: _location, ...withoutPoint } = event;
    await saveIncomingEvents(store, source, [
      {
        ...withoutPoint,
        externalId: 'ostanbo',
        venueName: 'Östanbo',
        meta: {
          address: {
            address: 'Östanbogården, Östanbo',
            country: 'Sweden' as const,
          },
        },
      },
    ]);
    const calls: string[] = [];
    const runner: PromptRunner = {
      id: 'once',
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
          address: { address: 'Östanbo', rank: 40 },
        }));
      },
    };
    const previousKey = process.env.GOOGLE_MAPS_API_KEY;
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    try {
      await scanPendingEvents(store, runner, undefined, {
        fetch: async (input) => {
          const url = String(input);
          if (url.includes('maps.googleapis.com')) calls.push(url);
          return Response.json({
            status: 'OK',
            results: [
              {
                formatted_address: 'Viaduktvägen 6, 826 72 Sandarne, Sverige',
                address_components: [
                  { long_name: '6', types: ['street_number'] },
                  { long_name: 'Viaduktvägen', types: ['route'] },
                  { long_name: 'Sandarne', types: ['postal_town'] },
                  { long_name: 'Sweden', short_name: 'SE', types: ['country'] },
                ],
                geometry: {
                  location: { lat: 61.259656, lng: 17.135223 },
                  location_type: 'ROOFTOP',
                },
              },
            ],
          });
        },
      });
    } finally {
      if (previousKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
      else process.env.GOOGLE_MAPS_API_KEY = previousKey;
    }
    expect(calls).toHaveLength(1);
    expect(store.events[0]?.location).toBeUndefined();
  });

  it('uses the point the model chose and does not geocode', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const { location: _location, ...withoutPoint } = event;
    const chosen = { lat: 61.26, lng: 17.14 };
    await saveIncomingEvents(store, source, [
      {
        ...withoutPoint,
        externalId: 'chosen-point',
        meta: {
          address: { address: 'Östanbogården, Östanbo', country: 'Sweden' as const },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'chosen-point',
      lookupPublisher: async () => ({ ok: true, profile: null }),
      async scan(batch) {
        expect(batch[0]?.location).toBeUndefined();
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
          chosenPoint: chosen,
        }));
      },
    };
    await scanPendingEvents(store, runner, undefined, {
      fetch: async () => {
        throw new Error('geocoder should not be called');
      },
    });
    expect(store.events[0]?.location).toEqual(chosen);
  });

  it('keeps the venue the model chose when the address rank is over 80', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const cinema = { lat: 61.23, lng: 16.56 };
    const venue = await store.saveVenue({
      name: 'Biografen Kilafors',
      city: 'Kilafors',
      nameKey: 'biografen kilafors',
      cityKey: 'kilafors',
      location: cinema,
      address: 'Stationsgatan 11',
    });
    const { location: _location, ...withoutPoint } = event;
    await saveIncomingEvents(store, source, [
      {
        ...withoutPoint,
        externalId: 'chosen-venue',
        venueName: 'Biografen',
        meta: {
          address: {
            address: 'Biografen Kilafors, Stationsgatan Kilafors',
            city: 'Kilafors',
            country: 'Sweden' as const,
          },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'chosen-venue',
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
          chosenPoint: cinema,
          chosenVenueId: venue.id,
          possibleVenues: [{ venueId: venue.id, rank: 95 }],
          address: {
            address: 'Stationsgatan 11',
            city: 'Kilafors',
            country: 'Sweden',
            rank: 90,
          },
        }));
      },
    };
    await scanPendingEvents(store, runner, undefined, {
      fetch: async () => {
        throw new Error('geocoder should not be called');
      },
    });
    expect(store.events[0]?.location).toEqual(cinema);
    expect(store.events[0]?.occasions[0]?.venueId).toBe(venue.id);
    expect(store.events[0]?.occasions[0]?.venueName).toBe('Biografen Kilafors');
  });

  it('keeps the point when the same address is ranked again', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const { location: _location, ...withoutPoint } = event;
    const rooftop = { lat: 61.303, lng: 17.06 };
    await saveIncomingEvents(store, source, [
      {
        ...withoutPoint,
        externalId: 'storgatan-once',
        meta: {
          address: {
            address: 'Storgatan 1',
            city: 'Söderhamn',
            country: 'Sweden' as const,
          },
        },
      },
    ]);
    const calls: string[] = [];
    const runner: PromptRunner = {
      id: 'same-address',
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
          address: { address: 'Storgatan 1', city: 'Söderhamn', rank: 90 },
        }));
      },
    };
    const previousKey = process.env.GOOGLE_MAPS_API_KEY;
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    try {
      await scanPendingEvents(store, runner, undefined, {
        fetch: async (input) => {
          const url = String(input);
          if (url.includes('maps.googleapis.com')) calls.push(url);
          return Response.json({
            status: 'OK',
            results: [
              {
                formatted_address: 'Storgatan 1, 826 32 Söderhamn, Sverige',
                address_components: [
                  { long_name: '1', types: ['street_number'] },
                  { long_name: 'Storgatan', types: ['route'] },
                  { long_name: 'Söderhamn', types: ['postal_town'] },
                  { long_name: 'Sweden', short_name: 'SE', types: ['country'] },
                ],
                geometry: {
                  location: rooftop,
                  location_type: 'ROOFTOP',
                },
              },
            ],
          });
        },
      });
    } finally {
      if (previousKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
      else process.env.GOOGLE_MAPS_API_KEY = previousKey;
    }
    expect(calls).toHaveLength(1);
    expect(store.events[0]?.location).toEqual(rooftop);
  });

  it('ignores a venue id that is not a uuid', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const runner: PromptRunner = {
      id: 'venue-id',
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
          possibleVenues: [{ venueId: 'not-an-id', rank: 95 }],
        }));
      },
    };
    await scanPendingEvents(store, runner, undefined, {
      fetch: async () => {
        throw new Error('geocoder should not be called');
      },
    });
    expect(store.events[0]?.status).toBe('in_review');
    const output = store.events[0]?.llmOutput as { scanLog?: string } | null;
    expect(output?.scanLog).toContain('The venue id was not a uuid.');
    expect(store.events[0]?.occasions[0]?.venueName).toBe('Helsingehus');
  });

  it('replaces a stored address and point when the model ranks the address over 80', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const found = { lat: 61.96, lng: 16.8 };
    await saveIncomingEvents(store, source, [
      {
        ...event,
        meta: {
          address: {
            address: 'Kalavägen 10',
            city: 'Järvsö',
            country: 'Sweden' as const,
            location: { lat: 61.7158943, lng: 16.1693209 },
          },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'ranked-address',
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
          llmOutput: {
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: 'fetchEventPage',
                        arguments: '{"url":"https://example.test/event"}',
                      },
                    },
                  ],
                },
              },
            ],
          },
          address: { address: 'Storgatan 9', city: 'Färila', country: 'Sweden', rank: 90 },
        }));
      },
    };

    await scanPendingEvents(store, runner, undefined, {
      fetch: async () =>
        Response.json({
          features: [
            {
              geometry: { coordinates: [found.lng, found.lat] },
              properties: {
                countrycode: 'SE',
                housenumber: '9',
                street: 'Storgatan',
                city: 'Färila',
              },
            },
          ],
        }),
    });

    expect(store.events[0]?.location).toEqual(found);
    expect(store.events[0]?.occasions[0]?.location).toEqual(found);
    expect(store.events[0]?.meta.address).toEqual({
      address: 'Storgatan 9',
      city: 'Färila',
      country: 'Sweden',
      location: found,
    });
    const scanLog = scanLogOf(store.events[0]?.llmOutput);
    expect(scanLog).toContain('Found');
    expect(scanLog).toContain('Storgatan 9');
    expect(scanLog).toContain('Lookups');
    expect(scanLog).toContain('fetchEventPage url=https://example.test/event');
    expect(scanLog).toContain('Decision');
    expect(scanLog).toContain(`${found.lat.toFixed(6)}, ${found.lng.toFixed(6)}`);
  });

  it('keeps the stored point when a high-rank address does not geocode', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [event]);
    const runner: PromptRunner = {
      id: 'ranked-miss',
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
          address: {
            address: 'Norra Järnvägsgatan 17',
            city: 'Ljusdal',
            country: 'Sweden',
            rank: 90,
          },
        }));
      },
    };

    await scanPendingEvents(store, runner, undefined, {
      fetch: async () => Response.json({ features: [] }),
    });

    expect(store.events[0]?.location).toEqual(event.location);
    expect(store.events[0]?.meta.address).toEqual({
      address: 'Norra Järnvägsgatan 17',
      city: 'Ljusdal',
      country: 'Sweden',
      location: event.location,
    });
  });

  it('keeps the stored point when the model repeats that address', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const point = { lat: 61.834031, lng: 16.052752 };
    await saveIncomingEvents(store, source, [
      {
        ...event,
        location: undefined,
        meta: {
          address: {
            address: 'Borrvägen 60',
            city: 'Ljusdal',
            country: 'Sweden' as const,
            location: point,
          },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'same-address',
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
          address: {
            address: 'borrvägen  60',
            zipCode: '827 94',
            city: 'ljusdal',
            country: 'Sweden',
            rank: 90,
          },
        }));
      },
    };

    await scanPendingEvents(store, runner, undefined, {
      fetch: async () => {
        throw new Error('a matching address should not be geocoded');
      },
    });

    expect(store.events[0]?.location).toEqual(point);
    expect(store.events[0]?.meta.address).toEqual({
      address: 'Borrvägen 60',
      zipCode: '82794',
      city: 'Ljusdal',
      country: 'Sweden',
      location: point,
    });
    expect(scanLogOf(store.events[0]?.llmOutput)).toContain(
      'Address rank 90 matches the stored address, so its point stays.',
    );
  });

  it('keeps the stored address point when a venue is also ranked over 90', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const point = { lat: 61.834031, lng: 16.052752 };
    const venuePoint = { lat: 61.84, lng: 16.06 };
    const venue = await store.saveVenue({
      name: 'Borr Bygdegård',
      city: 'Ljusdal',
      nameKey: 'borr bygdegård',
      cityKey: 'ljusdal',
      location: venuePoint,
    });
    await saveIncomingEvents(store, source, [
      {
        ...event,
        location: undefined,
        meta: {
          address: {
            address: 'Borrvägen 60',
            city: 'Ljusdal',
            country: 'Sweden' as const,
            location: point,
          },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'same-address-venue',
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
          address: { address: 'Borrvägen 60', city: 'Ljusdal', country: 'Sweden', rank: 90 },
          possibleVenues: [{ venueId: venue.id, rank: 95 }],
          possibleVenueNames: [{ name: 'Borr Bygdegård', rank: 95 }],
        }));
      },
    };

    await scanPendingEvents(store, runner, undefined, {
      fetch: async () => {
        throw new Error('a matching address should not be geocoded');
      },
    });

    expect(store.events[0]?.location).toEqual(point);
    expect(store.events[0]?.meta.address?.location).toEqual(point);
    expect(store.events[0]?.occasions[0]?.venueId).toBe(venue.id);
    expect(scanLogOf(store.events[0]?.llmOutput)).toContain('The address point stays.');
  });

  it('uses a remembered street point and does not geocode', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const point = { lat: 61.834031, lng: 16.052752 };
    await store.saveKnownAddress({
      street: 'Borrvägen 60',
      zipCode: '82794',
      city: 'Ljusdal',
      addressKey: addressCacheKey('Borrvägen 60', '827 94', 'Ljusdal'),
      location: point,
    });
    await saveIncomingEvents(store, source, [
      {
        ...event,
        location: undefined,
        meta: {
          address: { address: 'Kalavägen 10', city: 'Järvsö', country: 'Sweden' as const },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'cached-address',
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
          address: {
            address: 'Borrvägen 60',
            zipCode: '82794',
            city: 'Ljusdal',
            country: 'Sweden',
            rank: 90,
          },
        }));
      },
    };

    await scanPendingEvents(store, runner, undefined, {
      fetch: async () => {
        throw new Error('a remembered address should not be geocoded');
      },
    });

    expect(store.events[0]?.location).toEqual(point);
    expect(store.events[0]?.meta.address?.location).toEqual(point);
    expect(scanLogOf(store.events[0]?.llmOutput)).toContain(
      'Used the stored address "Borrvägen 60, 82794, Ljusdal"',
    );
  });

  it('remembers a street point for the next event', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const found = { lat: 61.303, lng: 17.06 };
    const { location: _location, ...withoutPoint } = event;
    await saveIncomingEvents(store, source, [
      {
        ...withoutPoint,
        externalId: 'first-street',
        meta: {
          address: { address: 'Storgatan 1', city: 'Söderhamn', country: 'Sweden' as const },
        },
      },
      {
        ...withoutPoint,
        externalId: 'second-street',
        meta: {
          address: { address: 'Kalavägen 10', city: 'Järvsö', country: 'Sweden' as const },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'remember-street',
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
          address: { address: 'Storgatan 1', city: 'Söderhamn', country: 'Sweden', rank: 90 },
        }));
      },
    };
    const calls: string[] = [];
    const previousMaps = process.env.GOOGLE_MAPS_API_KEY;
    const previousPlaces = process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    try {
      await scanPendingEvents(store, runner, undefined, {
        fetch: async (input) => {
          calls.push(String(input));
          return Response.json({
            features: [
              {
                geometry: { coordinates: [found.lng, found.lat] },
                properties: {
                  countrycode: 'SE',
                  housenumber: '1',
                  street: 'Storgatan',
                  city: 'Söderhamn',
                },
              },
            ],
          });
        },
      });
    } finally {
      if (previousMaps == null) delete process.env.GOOGLE_MAPS_API_KEY;
      else process.env.GOOGLE_MAPS_API_KEY = previousMaps;
      if (previousPlaces == null) delete process.env.GOOGLE_PLACES_API_KEY;
      else process.env.GOOGLE_PLACES_API_KEY = previousPlaces;
    }

    expect(calls).toHaveLength(1);
    expect(store.events.map((item) => item.location)).toEqual([found, found]);
    expect(
      await store.findKnownAddress(addressCacheKey('Storgatan 1', undefined, 'Söderhamn')),
    ).toEqual(found);
  });

  it('geocodes a matching street when the stored point is only the town', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    const town = { lat: 61.829, lng: 16.091 };
    const found = { lat: 61.834022, lng: 16.052642 };
    await store.saveKnownCity({ name: 'Ljusdal', cityKey: 'ljusdal', location: town });
    await saveIncomingEvents(store, source, [
      {
        ...event,
        location: undefined,
        meta: {
          address: {
            address: 'Borrvägen 60',
            city: 'Ljusdal',
            country: 'Sweden' as const,
            location: town,
          },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'town-point',
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
          address: {
            address: 'Borrvägen 60',
            city: 'Ljusdal',
            country: 'Sweden',
            rank: 90,
          },
        }));
      },
    };

    await scanPendingEvents(store, runner, undefined, {
      fetch: async () =>
        Response.json({
          features: [
            {
              geometry: { coordinates: [found.lng, found.lat] },
              properties: {
                countrycode: 'SE',
                housenumber: '60',
                street: 'Borrvägen',
                city: 'Ljusdal',
              },
            },
          ],
        }),
    });

    expect(store.events[0]?.location).toEqual(found);
    expect(store.events[0]?.meta.address?.location).toEqual(found);
  });

  it('keeps a stored address when the model address rank is 80', async () => {
    const store = createMemoryIngestStore();
    store.sources.push(source);
    await saveIncomingEvents(store, source, [
      {
        ...event,
        meta: {
          address: { address: 'Kalavägen 10', city: 'Järvsö', country: 'Sweden' as const },
        },
      },
    ]);
    const runner: PromptRunner = {
      id: 'low-address',
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
          address: { address: 'Storgatan 9', city: 'Färila', country: 'Sweden', rank: 80 },
        }));
      },
    };

    await scanPendingEvents(store, runner, undefined, {
      fetch: async () => {
        throw new Error('a rank of 80 does not replace the stored place');
      },
    });

    expect(store.events[0]?.location).toEqual(event.location);
    expect(store.events[0]?.meta.address).toEqual({
      address: 'Kalavägen 10',
      city: 'Järvsö',
      country: 'Sweden',
      location: event.location,
    });
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
            {
              geometry: { coordinates: [16.55, 61.8] },
              properties: {
                countrycode: 'SE',
                housenumber: '14',
                street: 'Köpmangatan',
                city: 'Delsbo',
              },
            },
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
    saved!.occasions.push({
      startsAt: new Date('2027-06-08T18:00:00.000Z'),
      endsAt: new Date('2027-06-08T21:00:00.000Z'),
      venueName: 'Bygdegården',
    });

    saved!.status = 'pending_scan';
    saved!.scanClaimedUntil = null;
    rank = 55;
    await scanPendingEvents(store, runner, undefined, { eventId });

    expect(saved?.venueName).toBe('Söderhamns Teater');
    expect(saved?.occasions.map((occasion) => occasion.venueName)).toEqual([
      'Söderhamns Teater',
      'Bygdegården',
    ]);
  });
});

function scanLogOf(output: unknown): string {
  if (!output || typeof output !== 'object' || !('scanLog' in output)) return '';
  const log = output.scanLog;
  return typeof log === 'string' ? log : '';
}
