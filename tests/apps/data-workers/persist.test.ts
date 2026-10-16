import type { DomainEvent } from '../../../packages/contracts/src/domain-events';
import { visitTagId } from '../../../packages/db/src/seed-tags';
import type { IncomingEvent } from '../../../packages/ingest/src/index';
import { createOllamaPromptRunner } from '../../../apps/data-workers/src/prompt-runners';
import {
  createMemoryIngestStore,
  type MemoryIngestStore,
} from '../../../apps/data-workers/src/memory-store';
import { persistSource, saveIncomingEvents } from '../../../apps/data-workers/src/persist';
import { scanPendingEvents } from '../../../apps/data-workers/src/scan-pending';
import type { SourceRecord } from '../../../apps/data-workers/src/store';
import { describe, expect, it, vi } from 'vitest';

const BANDY_TAGS = [visitTagId(30192), visitTagId(30194), visitTagId(30203)];

const source: SourceRecord = {
  id: '33333333-3333-4333-8333-333333333301',
  slug: 'visit-soderhamn',
  trust: 'review',
  config: {},
  enabled: false,
};

const bandy: IncomingEvent = {
  externalId: 'cbis:2678865:2025-01-31T19:00:00:2025-01-31T21:00:00',
  title: 'Broberg/Söderhamn Bandy - Edsbyns IF',
  description: 'Elitseriebandy',
  mode: 'physical',
  startsAt: '2025-01-31T19:00:00+01:00',
  endsAt: '2025-01-31T21:00:00+01:00',
  timezone: 'Europe/Stockholm',
  venueName: 'Helsingehus Arena, Hällåsen',
  location: { lat: 61.2887, lng: 17.0729 },
  sourceUrl: 'https://brobergsoderhamn.se/',
  organizerKeys: ['kansli@brobergsoderhamn.se', 'brobergsoderhamn.se'],
  organizerName: 'Kansliet, Broberg/Söderhamn Bandy',
  categoryHints: ['Idrott & Tävlingar', 'Bandy & Innebandy', 'Tävlingar'],
  tags: [
    { externalId: 'visit-soderhamn:30192', name: 'Idrott & Tävlingar' },
    { externalId: 'visit-soderhamn:30194', name: 'Bandy & Innebandy' },
    { externalId: 'visit-soderhamn:30203', name: 'Tävlingar' },
  ],
  meta: { ageLimit: 13 },
};

const quietModel = {
  id: 'test',
  async complete(): Promise<{ ok: true; content: string }> {
    return { ok: true, content: '{"externalIds":[]}' };
  },
};

/** Runs the scan job the import no longer does inline. */
async function finishScan(
  store: MemoryIngestStore,
  record: SourceRecord = source,
  enqueue?: { publish: (event: DomainEvent) => Promise<void> },
) {
  if (!store.sources.some((item) => item.id === record.id)) store.sources.push(record);
  return scanPendingEvents(
    store,
    createOllamaPromptRunner(store, { complete: quietModel.complete }),
    enqueue,
  );
}

describe('saveIncomingEvents', () => {
  it('saves a new import as pending_scan without a publisher', async () => {
    const store = createMemoryIngestStore();
    const published: DomainEvent[] = [];
    const counts = await saveIncomingEvents(store, source, [bandy], {
      publish: async (event) => {
        published.push(event);
      },
    });

    expect(counts).toMatchObject({ created: 1, updated: 0, skipped: 0, rejected: [] });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({
      title: bandy.title,
      status: 'pending_scan',
      publisherId: null,
      origin: 'imported',
      sourceUrl: bandy.sourceUrl,
      venueName: bandy.venueName,
      tagIds: BANDY_TAGS,
      meta: {
        ageLimit: 13,
        import: {
          organizerKeys: bandy.organizerKeys,
          organizerName: bandy.organizerName,
        },
      },
    });
    expect(store.publishers).toHaveLength(0);
    expect(store.refs).toHaveLength(1);
    expect(published).toEqual([]);
  });

  it('skips an external id deleted from review', async () => {
    const store = createMemoryIngestStore();
    await saveIncomingEvents(store, source, [bandy], { publish: async () => {} });
    const ref = store.refs[0];
    expect(ref).toBeDefined();
    if (!ref) return;
    store.suppressions.push({ sourceId: ref.sourceId, externalId: ref.externalId });
    store.events.splice(0, store.events.length);
    store.refs.splice(0, store.refs.length);

    const again = await saveIncomingEvents(store, source, [bandy], { publish: async () => {} });

    expect(again).toMatchObject({ created: 0, updated: 0, skipped: 1, rejected: [] });
    expect(store.events).toHaveLength(0);
  });

  it('adds links parsed from the description and keeps adapter links', async () => {
    const store = createMemoryIngestStore();
    await saveIncomingEvents(store, source, [
      {
        ...bandy,
        description:
          'Biljetter: https://brobergsoderhamn.ticketco.events/se/sv. Mer: https://example.com/about.',
        links: [{ type: 'tickets', url: 'https://brobergsoderhamn.ticketco.events/se/sv' }],
      },
    ]);
    expect(store.events[0]?.links).toEqual([
      { type: 'tickets', url: 'https://brobergsoderhamn.ticketco.events/se/sv' },
      { type: 'info', url: 'https://example.com/about' },
    ]);
  });

  it('skips an unchanged event and updates a changed one without leaving review', async () => {
    const store = createMemoryIngestStore();
    await saveIncomingEvents(store, source, [bandy]);
    const again = await saveIncomingEvents(store, source, [bandy]);
    expect(again).toMatchObject({ created: 0, updated: 0, skipped: 1 });

    const renamed = { ...bandy, title: 'Broberg - Edsbyn (uppdaterad)' };
    const updated = await saveIncomingEvents(store, source, [renamed]);
    expect(updated).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    expect(store.events).toHaveLength(1);
    expect(store.events[0]?.title).toBe(renamed.title);
    expect(store.events[0]?.status).toBe('pending_scan');
  });

  it('keeps price and links when a later import omits them', async () => {
    const store = createMemoryIngestStore();
    const priced: IncomingEvent = {
      ...bandy,
      priceAmount: 0,
      currency: 'SEK',
      links: [{ type: 'tickets', url: 'https://example.com/tickets' }],
    };
    await saveIncomingEvents(store, source, [priced]);
    const renamed = { ...bandy, title: 'Broberg - Edsbyn (uppdaterad)' };
    const updated = await saveIncomingEvents(store, source, [renamed]);
    expect(updated.updated).toBe(1);
    expect(store.events[0]).toMatchObject({
      title: renamed.title,
      priceAmount: 0,
      currency: 'SEK',
      links: [{ type: 'tickets', url: 'https://example.com/tickets' }],
    });

    const replaced: IncomingEvent = {
      ...renamed,
      title: 'Nytt pris',
      priceAmount: 15_000,
      links: [],
    };
    await saveIncomingEvents(store, source, [replaced]);
    expect(store.events[0]).toMatchObject({
      title: 'Nytt pris',
      priceAmount: 15_000,
      links: [],
    });
  });

  it('does not rewrite a cancelled event', async () => {
    const store = createMemoryIngestStore();
    await saveIncomingEvents(store, source, [bandy]);
    store.events[0]!.status = 'cancelled';
    const renamed = { ...bandy, title: 'Should stay cancelled' };
    const counts = await saveIncomingEvents(store, source, [renamed]);
    expect(counts.skipped).toBe(1);
    expect(store.events[0]?.title).toBe(bandy.title);
    expect(store.events[0]?.status).toBe('cancelled');
  });

  it('saves a lookalike as its own review event and names the existing one', async () => {
    const store = createMemoryIngestStore();
    store.events.push({
      id: '11111111-1111-4111-8111-111111111111',
      publisherId: 'native-publisher',
      title: bandy.title,
      description: null,
      status: 'published',
      origin: 'native',
      sourceUrl: 'https://example.org/bandy',
      startsAt: new Date(bandy.startsAt),
      endsAt: new Date(bandy.endsAt!),
      venueName: null,
      location: bandy.location,
      tagIds: [],
      refId: 'native-bandy',
      workerId: 'glada-hudik',
    });
    const counts = await saveIncomingEvents(store, source, [bandy]);
    await finishScan(store);
    expect(counts).toMatchObject({ created: 1, skipped: 0 });
    expect(store.events).toHaveLength(2);
    expect(store.events[0]?.title).toBe(bandy.title);
    expect(store.events[1]).toMatchObject({
      status: 'in_review',
      refId: bandy.externalId,
      workerId: source.slug,
      meta: {
        possibleDuplicate: {
          eventId: '11111111-1111-4111-8111-111111111111',
          title: bandy.title,
          refId: 'native-bandy',
          workerId: 'glada-hudik',
          matchedOn: 'title',
        },
      },
    });

    const again = await saveIncomingEvents(store, source, [
      { ...bandy, title: 'Should not replace the native event' },
    ]);
    expect(again.updated).toBe(1);
    expect(store.events[0]?.title).toBe(bandy.title);
    expect(store.events[1]?.title).toBe('Should not replace the native event');
  });

  it('flags a shared ticket url at the same place on the same day', async () => {
    const store = createMemoryIngestStore();
    const ticket = 'https://www.tickster.com/sv/event/example/';
    store.events.push({
      id: '22222222-2222-4222-8222-222222222222',
      publisherId: 'native-publisher',
      title: 'A different title from another source',
      description: null,
      status: 'published',
      origin: 'native',
      sourceUrl: 'https://www.gladahudik.se/sv/example',
      startsAt: new Date(bandy.startsAt),
      endsAt: new Date(bandy.endsAt!),
      venueName: null,
      location: bandy.location,
      tagIds: [],
      links: [{ type: 'tickets', url: 'https://www.tickster.com/sv/event/example' }],
    });
    const counts = await saveIncomingEvents(store, source, [
      { ...bandy, title: 'Hälsingland title', links: [{ type: 'tickets', url: ticket }] },
    ]);
    await finishScan(store);
    expect(counts.created).toBe(1);
    expect(store.events).toHaveLength(2);
    expect(store.events[1]?.meta).toMatchObject({
      possibleDuplicate: {
        eventId: '22222222-2222-4222-8222-222222222222',
        matchedOn: 'event-link',
      },
    });
    expect(store.events[0]?.title).toBe('A different title from another source');
  });

  it('matches a Citybreak product id whether or not it has the cbis prefix', async () => {
    const store = createMemoryIngestStore();
    store.events.push({
      id: '66666666-6666-4666-8666-666666666666',
      publisherId: 'native-publisher',
      title: 'A different title from Glada Hudik',
      description: null,
      status: 'published',
      origin: 'imported',
      sourceUrl: 'https://www.gladahudik.se/sv/example',
      startsAt: new Date(bandy.startsAt),
      endsAt: new Date(bandy.endsAt!),
      venueName: null,
      location: bandy.location,
      tagIds: [],
      refId: 'cbis:2678865:2025-01-31T19:00:00:2025-01-31T21:00:00',
      workerId: 'glada-hudik',
    });
    const counts = await saveIncomingEvents(store, source, [
      {
        ...bandy,
        externalId: '2678865:2025-01-31T19:00:00:2025-01-31T21:00:00',
        title: 'Hälsingland title',
        links: [],
      },
    ]);
    await finishScan(store);
    expect(counts.created).toBe(1);
    expect(store.events[1]?.meta?.possibleDuplicate?.matchedOn).toBe('id');
  });

  it('flags a shared ticket shop root as a link', async () => {
    const store = createMemoryIngestStore();
    const shop = 'https://brobergsoderhamn.ticketco.events/se/sv';
    store.events.push({
      id: '33333333-3333-4333-8333-333333333333',
      publisherId: 'native-publisher',
      title: 'Some other match',
      description: null,
      status: 'published',
      origin: 'native',
      sourceUrl: 'https://www.gladahudik.se/sv/other',
      startsAt: new Date(bandy.startsAt),
      endsAt: new Date(bandy.endsAt!),
      venueName: null,
      location: bandy.location,
      tagIds: [],
      links: [{ type: 'tickets', url: shop }],
    });
    const counts = await saveIncomingEvents(store, source, [
      { ...bandy, title: 'Hälsingland title', links: [{ type: 'tickets', url: shop }] },
    ]);
    await finishScan(store);
    expect(counts.created).toBe(1);
    expect(store.events[1]?.meta?.possibleDuplicate?.matchedOn).toBe('link');
  });

  it('does not flag a cancelled event', async () => {
    const store = createMemoryIngestStore();
    store.events.push({
      id: '44444444-4444-4444-8444-444444444444',
      publisherId: 'native-publisher',
      title: bandy.title,
      description: null,
      status: 'cancelled',
      origin: 'native',
      sourceUrl: 'https://www.gladahudik.se/sv/old',
      startsAt: new Date(bandy.startsAt),
      endsAt: new Date(bandy.endsAt!),
      venueName: null,
      location: bandy.location,
      tagIds: [],
    });
    const counts = await saveIncomingEvents(store, source, [bandy]);
    await finishScan(store);
    expect(counts.created).toBe(1);
    expect(store.events[1]?.meta?.possibleDuplicate).toBeUndefined();
  });

  it('flags another occasion within 30 minutes that shares a product id', async () => {
    const store = createMemoryIngestStore();
    const ticket = 'https://www.tickster.com/sv/event/example';
    await saveIncomingEvents(store, source, [
      { ...bandy, links: [{ type: 'tickets', url: ticket }] },
    ]);
    const later: IncomingEvent = {
      ...bandy,
      externalId: 'cbis:2678865:2025-01-31T19:20:00:2025-01-31T21:20:00',
      title: 'A second listing',
      startsAt: '2025-01-31T19:20:00+01:00',
      endsAt: '2025-01-31T21:20:00+01:00',
      links: [{ type: 'tickets', url: ticket }],
    };
    const counts = await saveIncomingEvents(store, source, [later]);
    await finishScan(store);
    expect(counts.created).toBe(1);
    expect(store.events).toHaveLength(2);
    expect(store.events[1]?.meta?.possibleDuplicate?.matchedOn).toBe('id');
  });

  it('does not flag the same title three hours later', async () => {
    const store = createMemoryIngestStore();
    store.events.push({
      id: '55555555-5555-4555-8555-555555555555',
      publisherId: 'native-publisher',
      title: bandy.title,
      description: null,
      status: 'published',
      origin: 'native',
      sourceUrl: 'https://www.gladahudik.se/sv/example',
      startsAt: new Date('2025-01-31T16:00:00+01:00'),
      endsAt: new Date('2025-01-31T18:00:00+01:00'),
      venueName: null,
      location: bandy.location,
      tagIds: [],
    });
    const counts = await saveIncomingEvents(store, source, [bandy]);
    await finishScan(store);
    expect(counts.created).toBe(1);
    expect(store.events[1]?.meta?.possibleDuplicate).toBeUndefined();
  });

  it('flags the same title 20 minutes later', async () => {
    const store = createMemoryIngestStore();
    store.events.push({
      id: '55555555-5555-4555-8555-555555555556',
      publisherId: 'native-publisher',
      title: bandy.title,
      description: null,
      status: 'published',
      origin: 'native',
      sourceUrl: 'https://www.gladahudik.se/sv/example',
      startsAt: new Date('2025-01-31T18:40:00+01:00'),
      endsAt: new Date('2025-01-31T20:40:00+01:00'),
      venueName: null,
      location: bandy.location,
      tagIds: [],
    });
    const counts = await saveIncomingEvents(store, source, [bandy]);
    await finishScan(store);
    expect(counts.created).toBe(1);
    expect(store.events[1]?.meta?.possibleDuplicate?.matchedOn).toBe('title');
  });

  it('reuses a publisher when a later key matches and remembers the stronger key', async () => {
    const store = createMemoryIngestStore();
    await saveIncomingEvents(store, source, [
      { ...bandy, organizerKeys: ['brobergsoderhamn.se'] },
    ]);
    const later = {
      ...bandy,
      externalId: 'cbis:later',
      title: 'Träning',
      organizerKeys: ['kansli@brobergsoderhamn.se', 'brobergsoderhamn.se'],
    };
    await saveIncomingEvents(store, source, [later]);
    await finishScan(store);
    expect(store.publishers).toHaveLength(1);
    expect(store.events[1]?.publisherId).toBe(store.events[0]?.publisherId);

    const byEmail = {
      ...bandy,
      externalId: 'cbis:email-only',
      title: 'Möte',
      organizerKeys: ['kansli@brobergsoderhamn.se'],
    };
    await saveIncomingEvents(store, source, [byEmail]);
    await finishScan(store);
    expect(store.publishers).toHaveLength(1);
    expect(store.events[2]?.publisherId).toBe(store.events[0]?.publisherId);
  });

  it('creates another publisher when no organizer key matches', async () => {
    const store = createMemoryIngestStore();
    await saveIncomingEvents(store, source, [bandy]);
    await saveIncomingEvents(store, source, [
      {
        ...bandy,
        externalId: 'cbis:other-org',
        title: 'Annan arrangör',
        organizerKeys: ['other@example.com'],
        organizerName: 'Annan',
      },
    ]);
    await finishScan(store);
    expect(store.publishers).toHaveLength(2);
    expect(store.events[1]?.publisherId).not.toBe(store.events[0]?.publisherId);
  });

  it('reuses a publisher another worker stored for the same email', async () => {
    const store = createMemoryIngestStore();
    const other = '33333333-3333-4333-8333-333333333399';
    const existing = store.linkPublisher({
      sourceId: other,
      organizerKey: 'kansli@brobergsoderhamn.se',
      name: 'Broberg',
      isTemporary: true,
    });
    const counts = await saveIncomingEvents(store, source, [bandy]);
    await finishScan(store);
    expect(counts.created).toBe(1);
    expect(store.publishers).toHaveLength(1);
    expect(store.events[0]?.publisherId).toBe(existing.publisherId);
  });

  it('reuses a publisher with the same name when it already has an event nearby', async () => {
    const store = createMemoryIngestStore();
    const other = '33333333-3333-4333-8333-333333333399';
    const existing = store.linkPublisher({
      sourceId: other,
      organizerKey: 'other-email@example.com',
      name: 'Kulturhuset',
      isTemporary: true,
    });
    store.events.push({
      id: '77777777-7777-4777-8777-777777777777',
      publisherId: existing.publisherId,
      title: 'Existing show',
      description: null,
      status: 'published',
      origin: 'imported',
      sourceUrl: 'https://www.gladahudik.se/sv/example',
      startsAt: new Date(bandy.startsAt),
      endsAt: new Date(bandy.endsAt!),
      venueName: null,
      location: bandy.location,
      tagIds: [],
    });
    const counts = await saveIncomingEvents(store, source, [
      {
        ...bandy,
        externalId: 'name-near',
        title: 'A different title',
        organizerKeys: ['kulturhuset'],
        organizerName: 'Kulturhuset',
      },
    ]);
    await finishScan(store);
    expect(counts.created).toBe(1);
    expect(store.publishers).toHaveLength(1);
    expect(store.events[1]?.publisherId).toBe(existing.publisherId);
  });

  it('does not reuse the same name when that publisher has no event nearby', async () => {
    const store = createMemoryIngestStore();
    const other = '33333333-3333-4333-8333-333333333399';
    store.linkPublisher({
      sourceId: other,
      organizerKey: 'other-email@example.com',
      name: 'Kulturhuset',
      isTemporary: true,
    });
    store.events.push({
      id: '77777777-7777-4777-8777-777777777778',
      publisherId: store.publishers[0]!.id,
      title: 'Far show',
      description: null,
      status: 'published',
      origin: 'imported',
      sourceUrl: 'https://www.gladahudik.se/sv/far',
      startsAt: new Date(bandy.startsAt),
      endsAt: new Date(bandy.endsAt!),
      venueName: null,
      location: { lat: (bandy.location?.lat ?? 0) + 1, lng: bandy.location?.lng ?? 0 },
      tagIds: [],
    });
    const counts = await saveIncomingEvents(store, source, [
      {
        ...bandy,
        externalId: 'name-far',
        title: 'A different title',
        organizerKeys: ['kulturhuset'],
        organizerName: 'Kulturhuset',
      },
    ]);
    await finishScan(store);
    expect(counts.created).toBe(1);
    expect(store.publishers).toHaveLength(2);
    expect(store.events[1]?.publisherId).not.toBe(store.publishers[0]?.id);
  });

  it('does not reuse another worker source slug', async () => {
    const store = createMemoryIngestStore();
    const existing = store.linkPublisher({
      sourceId: '33333333-3333-4333-8333-333333333399',
      organizerKey: 'glada-hudik',
      name: 'Glada Hudik',
      isTemporary: true,
    });
    const counts = await saveIncomingEvents(store, source, [
      { ...bandy, externalId: 'slug-only', organizerKeys: ['glada-hudik'] },
    ]);
    await finishScan(store);
    expect(counts.created).toBe(1);
    expect(store.events[0]?.publisherId).not.toBe(existing.publisherId);
  });

  it('saves a physical event that has no location', async () => {
    const store = createMemoryIngestStore();
    const counts = await saveIncomingEvents(store, source, [{ ...bandy, location: undefined }]);
    expect(counts).toMatchObject({ created: 1, rejected: [] });
    expect(store.events[0]?.location).toBeUndefined();
  });

  it('publishes and enqueues when the source is trusted and the publisher is verified', async () => {
    const store = createMemoryIngestStore();
    const link = store.linkPublisher({
      sourceId: source.id,
      organizerKey: bandy.organizerKeys[0]!,
      name: 'Broberg',
      isTemporary: false,
      verified: true,
    });
    const published: DomainEvent[] = [];
    const sink = {
      publish: async (event: DomainEvent) => {
        published.push(event);
      },
    };
    const trusted: SourceRecord = { ...source, trust: 'auto_publish' };
    const created = await saveIncomingEvents(store, trusted, [bandy], sink);
    expect(created.created).toBe(1);
    expect(store.events[0]?.status).toBe('pending_scan');
    expect(published).toEqual([]);
    await finishScan(store, trusted, sink);
    expect(store.events[0]).toMatchObject({ status: 'published', publisherId: link.publisherId });
    expect(published).toEqual([{ type: 'event.published', eventId: store.events[0]!.id }]);

    const updated = await saveIncomingEvents(
      store,
      trusted,
      [{ ...bandy, title: 'Broberg uppdaterad' }],
      sink,
    );
    expect(updated.updated).toBe(1);
    expect(published[1]).toMatchObject({
      type: 'event.updated',
      eventId: store.events[0]!.id,
    });
  });

  it('schedules a notification plan for a verified publisher and skips it otherwise', async () => {
    const store = createMemoryIngestStore();
    const future = {
      ...bandy,
      externalId: 'cbis:future',
      startsAt: '2027-06-01T18:00:00.000Z',
      endsAt: '2027-06-01T21:00:00.000Z',
    };
    const trusted: SourceRecord = { ...source, trust: 'auto_publish' };
    store.linkPublisher({
      sourceId: source.id,
      organizerKey: future.organizerKeys[0]!,
      name: 'Broberg',
      isTemporary: false,
      verified: true,
      importNotificationPlan: 'standard',
    });
    await saveIncomingEvents(store, trusted, [future]);
    await finishScan(store, trusted);
    expect(store.scheduledNotifications).toEqual([
      {
        eventId: store.events[0]!.id,
        planId: 'standard',
        offsets: ['week', 'day'],
        status: 'approved',
      },
    ]);

    const quiet = createMemoryIngestStore();
    quiet.linkPublisher({
      sourceId: source.id,
      organizerKey: future.organizerKeys[0]!,
      name: 'Broberg',
      isTemporary: false,
      verified: true,
      importNotificationPlan: null,
    });
    await saveIncomingEvents(quiet, trusted, [future]);
    await finishScan(quiet, trusted);
    expect(quiet.scheduledNotifications).toEqual([]);

    const unverified = createMemoryIngestStore();
    unverified.linkPublisher({
      sourceId: source.id,
      organizerKey: future.organizerKeys[0]!,
      name: 'Broberg',
      isTemporary: false,
      verified: false,
      importNotificationPlan: 'full',
    });
    await saveIncomingEvents(unverified, trusted, [future]);
    await finishScan(unverified, trusted);
    expect(unverified.scheduledNotifications).toEqual([]);
  });

  it('stores a review-trust import plan as pending until the event is published', async () => {
    const store = createMemoryIngestStore();
    const future = {
      ...bandy,
      externalId: 'cbis:review-future',
      startsAt: '2027-06-01T18:00:00.000Z',
      endsAt: '2027-06-01T21:00:00.000Z',
    };
    store.linkPublisher({
      sourceId: source.id,
      organizerKey: future.organizerKeys[0]!,
      name: 'Broberg',
      isTemporary: false,
      verified: true,
      importNotificationPlan: 'standard',
    });
    const published: DomainEvent[] = [];
    await saveIncomingEvents(store, source, [future], {
      publish: async (event) => {
        published.push(event);
      },
    });
    await finishScan(store);
    expect(store.events[0]?.status).toBe('in_review');
    expect(published).toEqual([]);
    expect(store.scheduledNotifications).toEqual([
      {
        eventId: store.events[0]!.id,
        planId: 'standard',
        offsets: ['week', 'day'],
        status: 'pending',
      },
    ]);
  });
});

describe('event images', () => {
  const enqueue = { publish: async () => {} };
  const withImage = { ...bandy, imageUrl: 'https://images.example/bandy.jpg' };

  it('stores a hero image on create and skips an unchanged source url', async () => {
    const store = createMemoryIngestStore();
    const puts: string[] = [];
    const images = {
      put: async ({ sourceUrl }: { eventId: string; sourceUrl: string }) => {
        puts.push(sourceUrl);
        return {
          s3Key: `events/${store.events[0]?.id ?? 'pending'}/main`,
          contentType: 'image/jpeg',
        };
      },
    };
    await saveIncomingEvents(store, source, [withImage], enqueue, images);
    expect(puts).toEqual([withImage.imageUrl]);
    expect(store.images).toHaveLength(1);
    expect(store.images[0]).toMatchObject({
      eventId: store.events[0]!.id,
      sourceUrl: withImage.imageUrl,
      contentType: 'image/jpeg',
    });

    const renamed = { ...withImage, title: 'Broberg uppdaterad' };
    await saveIncomingEvents(store, source, [renamed], enqueue, images);
    expect(puts).toEqual([withImage.imageUrl]);
  });

  it('does not attach an image to the event a duplicate points at', async () => {
    const store = createMemoryIngestStore();
    store.events.push({
      id: '11111111-1111-4111-8111-111111111111',
      publisherId: 'native-publisher',
      title: bandy.title,
      description: null,
      status: 'published',
      origin: 'native',
      sourceUrl: 'https://example.org/bandy',
      startsAt: new Date(bandy.startsAt),
      endsAt: new Date(bandy.endsAt!),
      venueName: null,
      location: bandy.location,
      tagIds: [],
    });
    const puts: string[] = [];
    await saveIncomingEvents(store, source, [withImage], enqueue, {
      put: async ({ sourceUrl }) => {
        puts.push(sourceUrl);
        return { s3Key: 'events/imported/main', contentType: 'image/jpeg' };
      },
    });
    expect(puts).toEqual([withImage.imageUrl]);
    expect(store.images).toHaveLength(1);
    expect(store.images[0]?.eventId).not.toBe('11111111-1111-4111-8111-111111111111');
  });

  it('retries the image on a later run when the first copy did not store one', async () => {
    const store = createMemoryIngestStore();
    let calls = 0;
    const images = {
      put: async ({ eventId }: { eventId: string; sourceUrl: string }) => {
        calls += 1;
        if (calls === 1) return null;
        return { s3Key: `events/${eventId}/main`, contentType: 'image/jpeg' };
      },
    };
    await saveIncomingEvents(store, source, [withImage], enqueue, images);
    expect(store.images).toHaveLength(0);
    const again = await saveIncomingEvents(store, source, [withImage], enqueue, images);
    expect(again.skipped).toBe(1);
    expect(store.images).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('keeps the event when the image upload throws', async () => {
    const store = createMemoryIngestStore();
    const counts = await saveIncomingEvents(store, source, [withImage], enqueue, {
      put: async () => {
        throw new Error('garage down');
      },
    });
    expect(counts.created).toBe(1);
    expect(store.events).toHaveLength(1);
    expect(store.images).toHaveLength(0);
  });

  it('stores crawled images after the hero and drops a gallery image that disappeared', async () => {
    const store = createMemoryIngestStore();
    const puts: { sourceUrl: string; role?: string }[] = [];
    const images = {
      put: async ({ sourceUrl, role }: { eventId: string; sourceUrl: string; role?: string }) => {
        puts.push({ sourceUrl, role });
        return { s3Key: `events/pending/${role ?? 'main'}`, contentType: 'image/jpeg' };
      },
    };
    const withImages = {
      ...bandy,
      imageUrl: 'https://images.example/api.jpg',
      imageUrls: ['https://images.example/og.jpg', 'https://images.example/photo.jpg'],
    };
    await saveIncomingEvents(store, source, [withImages], enqueue, images);
    expect(puts.map((put) => put.sourceUrl)).toEqual([
      'https://images.example/api.jpg',
      'https://images.example/og.jpg',
      'https://images.example/photo.jpg',
    ]);
    expect(store.images.map((image) => image.role)).toEqual(['main', 'gallery-1', 'gallery-2']);

    puts.length = 0;
    await saveIncomingEvents(
      store,
      source,
      [{ ...withImages, imageUrls: ['https://images.example/og.jpg'] }],
      enqueue,
      images,
    );
    expect(puts).toEqual([]);
    expect(store.images.map((image) => image.role)).toEqual(['main', 'gallery-1']);

    await saveIncomingEvents(
      store,
      source,
      [{ ...withImages, imageUrls: undefined }],
      enqueue,
      images,
    );
    expect(store.images.map((image) => image.role)).toEqual(['main', 'gallery-1']);
  });
});

describe('persistSource', () => {
  it('saves the example fixture and skips it on the next run', async () => {
    const store = createMemoryIngestStore();
    store.sources.push({
      id: '44444444-4444-4444-8444-444444444401',
      slug: 'example-fixture',
      trust: 'review',
      config: {},
      enabled: true,
    });
    vi.stubGlobal('fetch', async () => {
      throw new Error('ollama is not running');
    });
    try {
      const first = await persistSource(store, 'example-fixture');
      expect(first).toMatchObject({ fetched: 2, created: 2, updated: 0, skipped: 0, rejected: [] });
      expect(store.runs[0]).toMatchObject({ status: 'ok', created: 2 });
      expect(store.events.every((event) => event.status === 'pending_scan')).toBe(true);

      const second = await persistSource(store, 'example-fixture');
      expect(second).toMatchObject({ created: 0, skipped: 2 });
      expect(store.events).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
