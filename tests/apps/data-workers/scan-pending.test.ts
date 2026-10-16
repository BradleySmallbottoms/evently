import { describe, expect, it } from 'vitest';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { saveIncomingEvents } from '../../../apps/data-workers/src/persist';
import { scanPendingEvents } from '../../../apps/data-workers/src/scan-pending';
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
        return batch.map(
          (item): ScanOutcome => ({
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
          }),
        );
      },
    };

    const summary = await scanPendingEvents(store, runner);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((item) => item.title).sort()).toEqual(['Konsert', 'Marknad']);
    expect(summary).toMatchObject({ claimed: 2, review: 2, published: 0, unavailable: 0 });
    expect(store.events.every((row) => row.status === 'in_review')).toBe(true);
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
        return batch.map(
          (item, index): ScanOutcome =>
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
        async complete() {
          calls += 1;
          return { ok: false, reason: 'unavailable' };
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
        async complete() {
          return { ok: false, reason: 'unavailable' };
        },
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
      claimedUntil: claimed!.claimedUntil,
    });

    expect(saved).toBe(false);
    expect(store.events[0]).toMatchObject({ status: 'pending_scan', publisherId: null });
  });
});
