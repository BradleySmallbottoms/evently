import type { DomainEvent } from '../../../packages/contracts/src/domain-events';
import { visitTagId } from '../../../packages/db/src/seed-tags';
import type { IncomingEvent } from '../../../packages/ingest/src/index';
import { createMemoryIngestStore } from '../../../apps/data-workers/src/memory-store';
import { persistSource, saveIncomingEvents } from '../../../apps/data-workers/src/persist';
import type { SourceRecord } from '../../../apps/data-workers/src/store';
import { describe, expect, it } from 'vitest';

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
  organizerKey: 'kansli@brobergsoderhamn.se',
  organizerName: 'Kansliet, Broberg/Söderhamn Bandy',
  categoryHints: ['Idrott & Tävlingar', 'Bandy & Innebandy', 'Tävlingar'],
  tags: [
    { externalId: 'visit-soderhamn:30192', name: 'Idrott & Tävlingar' },
    { externalId: 'visit-soderhamn:30194', name: 'Bandy & Innebandy' },
    { externalId: 'visit-soderhamn:30203', name: 'Tävlingar' },
  ],
  meta: { ageLimit: 13 },
};

describe('saveIncomingEvents', () => {
  it('creates an in-review event and a temporary publisher', async () => {
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
      status: 'in_review',
      origin: 'imported',
      sourceUrl: bandy.sourceUrl,
      venueName: bandy.venueName,
      tagIds: BANDY_TAGS,
      meta: { ageLimit: 13 },
    });
    expect(store.publishers).toHaveLength(1);
    expect(store.publishers[0]).toMatchObject({
      name: 'Kansliet, Broberg/Söderhamn Bandy',
      isTemporary: true,
    });
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
    expect(store.events[0]?.status).toBe('in_review');
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

  it('links a cross-source match instead of creating a second event', async () => {
    const store = createMemoryIngestStore();
    store.events.push({
      id: 'native-1',
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
    const counts = await saveIncomingEvents(store, source, [bandy]);
    expect(counts).toMatchObject({ created: 0, skipped: 1 });
    expect(store.events).toHaveLength(1);
    expect(store.refs[0]).toMatchObject({ eventId: 'native-1', externalId: bandy.externalId });

    const again = await saveIncomingEvents(store, source, [
      { ...bandy, title: 'Should not replace the native event' },
    ]);
    expect(again.skipped).toBe(1);
    expect(store.events[0]?.title).toBe(bandy.title);
  });

  it('saves a physical event that has no location', async () => {
    const store = createMemoryIngestStore();
    const counts = await saveIncomingEvents(store, source, [{ ...bandy, location: undefined }]);
    expect(counts).toMatchObject({ created: 1, rejected: [] });
    expect(store.events[0]?.location).toBeUndefined();
  });

  it('publishes and enqueues when the source is trusted and the publisher is mapped', async () => {
    const store = createMemoryIngestStore();
    const link = store.linkPublisher({
      sourceId: source.id,
      organizerKey: bandy.organizerKey,
      name: 'Broberg',
      isTemporary: false,
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
      organizerKey: future.organizerKey,
      name: 'Broberg',
      isTemporary: false,
      verified: true,
      importNotificationPlan: 'standard',
    });
    await saveIncomingEvents(store, trusted, [future]);
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
      organizerKey: future.organizerKey,
      name: 'Broberg',
      isTemporary: false,
      verified: true,
      importNotificationPlan: null,
    });
    await saveIncomingEvents(quiet, trusted, [future]);
    expect(quiet.scheduledNotifications).toEqual([]);

    const unverified = createMemoryIngestStore();
    unverified.linkPublisher({
      sourceId: source.id,
      organizerKey: future.organizerKey,
      name: 'Broberg',
      isTemporary: false,
      verified: false,
      importNotificationPlan: 'full',
    });
    await saveIncomingEvents(unverified, trusted, [future]);
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
      organizerKey: future.organizerKey,
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

  it('does not attach an image to a cross-source match', async () => {
    const store = createMemoryIngestStore();
    store.events.push({
      id: 'native-1',
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
        return { s3Key: 'events/native-1/main', contentType: 'image/jpeg' };
      },
    });
    expect(puts).toEqual([]);
    expect(store.images).toHaveLength(0);
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
    const first = await persistSource(store, 'example-fixture');
    expect(first).toMatchObject({ fetched: 2, created: 2, updated: 0, skipped: 0, rejected: [] });
    expect(store.runs[0]).toMatchObject({ status: 'ok', created: 2 });
    expect(store.events.every((event) => event.status === 'in_review')).toBe(true);

    const second = await persistSource(store, 'example-fixture');
    expect(second).toMatchObject({ created: 0, skipped: 2 });
    expect(store.events).toHaveLength(2);
  });
});
