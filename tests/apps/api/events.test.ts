import { PUBLISHER_SESSION_COOKIE } from '../../../packages/auth/src/index';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { createMemoryDomainEventPublisher } from '../../../apps/api/src/services/domain-events/memory';
import {
  createMemoryEventServices,
  releaseAwaitingEventsInStore,
} from '../../../apps/api/src/services/events/memory';
import { SEED_TAGS } from '../../../packages/db/src/seed-tags';
import {
  createMemoryStore,
  type MemoryEventRow,
} from '../../../apps/api/src/services/memory-store';

async function registerAndLogin(app: ReturnType<typeof createApp>, email: string) {
  const registered = await app.request('/v1/publishers/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'long-enough-password',
      name: 'Test Publisher',
      type: 'org',
    }),
  });
  expect(registered.status).toBe(201);
  const reg = (await registered.json()) as {
    publisherId: string;
    verificationToken?: string;
  };
  await app.request('/v1/publishers/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: reg.verificationToken }),
  });
  const login = await app.request('/v1/publishers/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'long-enough-password' }),
  });
  expect(login.status).toBe(200);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
  expect(cookie).toContain(PUBLISHER_SESSION_COOKIE);
  return { publisherId: reg.publisherId, cookie };
}

const physicalBody = {
  title: 'Konsert i parken',
  mode: 'physical' as const,
  startsAt: '2026-12-01T18:00:00.000Z',
  endsAt: '2026-12-01T21:00:00.000Z',
  location: { lat: 61.3037, lng: 17.0592 },
  tagIds: [SEED_TAGS[0]!.id],
};

describe('events', () => {
  it('lists seeded tags', async () => {
    const res = await createApp().request('/v1/tags');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { slug: string; name: string }[] };
    expect(
      body.items.some(
        (tag) => tag.slug === 'idrott-tavlingar' && tag.name === 'Idrott & Tävlingar',
      ),
    ).toBe(true);
  });

  it('upcoming=true returns tags on published events that have not ended', async () => {
    const store = createMemoryStore();
    const now = new Date('2026-06-15T12:00:00.000Z');
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => now },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => now }, store);
    const app = createApp({ auth, events });
    const { publisherId, cookie } = await registerAndLogin(app, 'tags-upcoming@example.com');

    const created = await app.request(`/v1/publishers/${publisherId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(physicalBody),
    });
    expect(created.status).toBe(201);
    const draft = (await created.json()) as { id: string };
    const row = store.events.get(draft.id);
    if (!row) throw new Error('missing event');

    const before = await app.request('/v1/tags?upcoming=true');
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ items: [] });

    row.status = 'published';
    const upcoming = await app.request('/v1/tags?upcoming=true');
    const upcomingBody = (await upcoming.json()) as { items: { id: string }[] };
    expect(upcomingBody.items.map((tag) => tag.id)).toEqual([SEED_TAGS[0]!.id]);

    row.endsAt = '2026-06-01T12:00:00.000Z';
    row.endsAtDate = new Date(row.endsAt);
    const ended = await app.request('/v1/tags?upcoming=true');
    expect(await ended.json()).toEqual({ items: [] });
  });

  it('upcoming place returns tags on a current event inside the radius', async () => {
    const store = createMemoryStore();
    const now = new Date('2026-06-15T12:00:00.000Z');
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => now },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => now }, store);
    const app = createApp({ auth, events });
    const { publisherId, cookie } = await registerAndLogin(app, 'tags-place@example.com');

    async function publish(body: typeof physicalBody) {
      const created = await app.request(`/v1/publishers/${publisherId}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });
      expect(created.status).toBe(201);
      const draft = (await created.json()) as { id: string };
      const row = store.events.get(draft.id);
      if (!row) throw new Error('missing event');
      row.status = 'published';
      return row;
    }

    const near = await publish({
      ...physicalBody,
      title: 'Visby concert',
      location: { lat: 57.6348, lng: 18.2948 },
      tagIds: [SEED_TAGS[1]!.id],
    });
    await publish({
      ...physicalBody,
      title: 'Söderhamn match',
      location: { lat: 61.3037, lng: 17.0592 },
      tagIds: [SEED_TAGS[0]!.id],
    });

    const place = await app.request('/v1/tags?upcoming=true&lat=57.6348&lng=18.2948&radiusM=25000');
    expect(place.status).toBe(200);
    const body = (await place.json()) as { items: { id: string }[] };
    expect(body.items.map((tag) => tag.id)).toEqual([SEED_TAGS[1]!.id]);

    near.location = null;
    const unpinned = await app.request(
      '/v1/tags?upcoming=true&lat=57.6348&lng=18.2948&radiusM=25000',
    );
    expect(await unpinned.json()).toEqual({ items: [] });

    const partial = await app.request('/v1/tags?upcoming=true&lat=57.6348');
    expect(partial.status).toBe(400);
  });

  it('creates a draft, publishes as awaiting_verification, then releases on verify', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => new Date() }, store);
    const app = createApp({ auth, events });

    const { publisherId, cookie } = await registerAndLogin(app, 'events@example.com');

    const created = await app.request(`/v1/publishers/${publisherId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(physicalBody),
    });
    expect(created.status).toBe(201);
    const draft = (await created.json()) as { id: string; status: string };
    expect(draft.status).toBe('draft');

    const published = await app.request(`/v1/manage/events/${draft.id}/publish`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(published.status).toBe(200);
    const pub = (await published.json()) as { status: string };
    expect(pub.status).toBe('awaiting_verification');

    const publicBefore = await app.request('/v1/events?lat=61.3037&lng=17.0592&radiusM=50000');
    expect(publicBefore.status).toBe(200);
    expect(((await publicBefore.json()) as { items: unknown[] }).items).toHaveLength(0);

    const released = releaseAwaitingEventsInStore(store, publisherId, new Date());
    expect(released).toBe(1);

    const publicAfter = await app.request('/v1/events?lat=61.3037&lng=17.0592&radiusM=50000');
    const listed = (await publicAfter.json()) as { items: { id: string; status: string }[] };
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.id).toBe(draft.id);
    expect(listed.items[0]?.status).toBe('published');

    const detail = await app.request(`/v1/events/${draft.id}`);
    expect(detail.status).toBe(200);

    const managed = await app.request(`/v1/manage/events/${draft.id}`, {
      headers: { cookie },
    });
    expect(managed.status).toBe(200);
    expect((await managed.json()) as { id: string }).toMatchObject({ id: draft.id });
  });

  it('publishes immediately when the publisher is already verified', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const domainEvents = createMemoryDomainEventPublisher();
    const events = createMemoryEventServices(auth, { now: () => new Date(), domainEvents }, store);
    const app = createApp({ auth, events });

    const { publisherId, cookie } = await registerAndLogin(app, 'verified@example.com');
    const publisher = store.publishers.get(publisherId)!;
    publisher.status = 'published';

    const created = await app.request(`/v1/publishers/${publisherId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(physicalBody),
    });
    const draft = (await created.json()) as { id: string };

    const published = await app.request(`/v1/manage/events/${draft.id}/publish`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(((await published.json()) as { status: string }).status).toBe('published');
    expect(domainEvents.events).toEqual([{ type: 'event.published', eventId: draft.id }]);

    const cancelled = await app.request(`/v1/manage/events/${draft.id}/cancel`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as { status: string }).status).toBe('cancelled');
  });

  it('does not enqueue domain events for awaiting_verification publishes', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const domainEvents = createMemoryDomainEventPublisher();
    const events = createMemoryEventServices(auth, { now: () => new Date(), domainEvents }, store);
    const app = createApp({ auth, events });

    const { publisherId, cookie } = await registerAndLogin(app, 'unverified-enqueue@example.com');
    const created = await app.request(`/v1/publishers/${publisherId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(physicalBody),
    });
    const draft = (await created.json()) as { id: string };

    await app.request(`/v1/manage/events/${draft.id}/publish`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(domainEvents.events).toEqual([]);
  });

  it('lists publisher events and updates a managed event', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => new Date() }, store);
    const app = createApp({ auth, events });

    const { publisherId, cookie } = await registerAndLogin(app, 'owner@example.com');
    const created = await app.request(`/v1/publishers/${publisherId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(physicalBody),
    });
    expect(created.status).toBe(201);
    const draft = (await created.json()) as { id: string };

    const list = await app.request(`/v1/publishers/${publisherId}/events`, {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { items: { id: string }[] };
    expect(listed.items.some((item) => item.id === draft.id)).toBe(true);

    const updated = await app.request(`/v1/manage/events/${draft.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        title: 'Uppdaterad titel',
        description: 'Ny beskrivning',
        mode: 'digital',
        onlineUrl: 'https://example.com/live',
      }),
    });
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as {
      title: string;
      mode: string;
      onlineUrl: string | null;
    };
    expect(body.title).toBe('Uppdaterad titel');
    expect(body.mode).toBe('digital');
    expect(body.onlineUrl).toBe('https://example.com/live');
  });

  it('lists featured published events before later starts', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(store);
    const app = createApp({
      auth,
      events: createMemoryEventServices(auth, { now: () => new Date() }, store),
    });
    const featuredId = '11111111-1111-4111-8111-111111111401';
    const soonerId = '11111111-1111-4111-8111-111111111402';
    const base = {
      publisherId: '11111111-1111-4111-8111-111111111403',
      description: null,
      mode: 'physical' as const,
      status: 'published' as const,
      origin: 'native' as const,
      timezone: 'Europe/Stockholm',
      venueName: 'Hall',
      location: { lat: 61.3037, lng: 17.0592 },
      geofenceRadiusM: 100,
      onlineUrl: null,
      priceAmount: null,
      currency: 'SEK',
      publisherName: 'Hall',
      links: [],
      imageUrl: null,
      imageUrls: [],
      tagIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    function row(id: string, title: string, startsAt: string, featured: boolean): MemoryEventRow {
      return {
        ...base,
        id,
        title,
        startsAt,
        endsAt: startsAt,
        featured,
        checkInEnabled: false,
        meta: {},
        numSaved: 0,
        numComing: 0,
        startsAtDate: new Date(startsAt),
        endsAtDate: new Date(startsAt),
      };
    }
    store.events.set(soonerId, row(soonerId, 'Sooner', '2026-12-02T18:00:00.000Z', false));
    store.events.set(
      featuredId,
      row(featuredId, 'Featured later', '2026-12-20T18:00:00.000Z', true),
    );

    const taggedId = '11111111-1111-4111-8111-111111111404';
    const tagId = SEED_TAGS[0]!.id;
    store.events.get(featuredId)!.tagIds = [tagId];
    store.events.set(taggedId, {
      ...row(taggedId, 'Tagged sooner', '2026-12-10T18:00:00.000Z', false),
      tagIds: [tagId],
    });

    const listed = await app.request('/v1/events?lat=61.3037&lng=17.0592&radiusM=50000');
    expect(listed.status).toBe(200);
    const items = (await listed.json()) as {
      items: { id: string; featured: boolean }[];
      nextOffset: number | null;
    };
    expect(items.items.map((item) => item.id)).toEqual([featuredId, soonerId, taggedId]);
    expect(items.items[0]?.featured).toBe(true);
    expect(items.nextOffset).toBeNull();

    const first = await app.request('/v1/events?lat=61.3037&lng=17.0592&radiusM=50000&limit=1');
    const firstBody = (await first.json()) as {
      items: { id: string }[];
      nextOffset: number | null;
    };
    expect(firstBody.items.map((item) => item.id)).toEqual([featuredId]);
    expect(firstBody.nextOffset).toBe(1);

    const second = await app.request(
      '/v1/events?lat=61.3037&lng=17.0592&radiusM=50000&limit=1&offset=1',
    );
    const secondBody = (await second.json()) as {
      items: { id: string }[];
      nextOffset: number | null;
    };
    expect(secondBody.items.map((item) => item.id)).toEqual([soonerId]);
    expect(secondBody.nextOffset).toBe(2);

    const tagged = await app.request(
      `/v1/events?lat=61.3037&lng=17.0592&radiusM=50000&tagId=${tagId}&limit=1`,
    );
    const taggedBody = (await tagged.json()) as {
      items: { id: string }[];
      nextOffset: number | null;
    };
    expect(taggedBody.items.map((item) => item.id)).toEqual([featuredId]);
    expect(taggedBody.nextOffset).toBe(1);

    const taggedNext = await app.request(
      `/v1/events?lat=61.3037&lng=17.0592&radiusM=50000&tagId=${tagId}&limit=1&offset=1`,
    );
    const taggedNextBody = (await taggedNext.json()) as {
      items: { id: string }[];
      nextOffset: number | null;
    };
    expect(taggedNextBody.items.map((item) => item.id)).toEqual([taggedId]);
    expect(taggedNextBody.nextOffset).toBeNull();

    const otherTagId = SEED_TAGS[1]!.id;
    store.events.get(soonerId)!.tagIds = [otherTagId];
    const either = await app.request(
      `/v1/events?lat=61.3037&lng=17.0592&radiusM=50000&tagIds=${tagId},${otherTagId}`,
    );
    const eitherBody = (await either.json()) as { items: { id: string }[] };
    expect(either.status).toBe(200);
    expect(eitherBody.items.map((item) => item.id)).toEqual([featuredId, soonerId, taggedId]);

    const onlyOther = await app.request(
      `/v1/events?lat=61.3037&lng=17.0592&radiusM=50000&tagIds=${otherTagId}`,
    );
    const onlyOtherBody = (await onlyOther.json()) as { items: { id: string }[] };
    expect(onlyOtherBody.items.map((item) => item.id)).toEqual([soonerId]);
  });

  it('leaves ended events out of the public list and keeps a whole day', async () => {
    const store = createMemoryStore();
    const now = new Date('2026-10-18T21:00:00.000Z');
    const auth = createMemoryAuthServices(store);
    const app = createApp({
      auth,
      events: createMemoryEventServices(auth, { now: () => now }, store),
    });
    const base = {
      publisherId: '11111111-1111-4111-8111-111111111403',
      description: null,
      mode: 'physical' as const,
      status: 'published' as const,
      origin: 'native' as const,
      timezone: 'Europe/Stockholm',
      venueName: 'Hall',
      location: { lat: 61.3037, lng: 17.0592 },
      geofenceRadiusM: 100,
      onlineUrl: null,
      priceAmount: null,
      currency: 'SEK',
      publisherName: 'Hall',
      links: [],
      imageUrl: null,
      imageUrls: [],
      tagIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      featured: false,
      checkInEnabled: false,
      meta: {},
      numSaved: 0,
      numComing: 0,
    };
    function row(id: string, title: string, startsAt: string, endsAt: string): MemoryEventRow {
      return {
        ...base,
        id,
        title,
        startsAt,
        endsAt,
        startsAtDate: new Date(startsAt),
        endsAtDate: new Date(endsAt),
      };
    }
    const pastId = '11111111-1111-4111-8111-111111111501';
    const laterId = '11111111-1111-4111-8111-111111111502';
    const todayId = '11111111-1111-4111-8111-111111111503';
    const yesterdayId = '11111111-1111-4111-8111-111111111504';
    store.events.set(
      pastId,
      row(pastId, 'Already over', '2026-10-15T17:00:00.000Z', '2026-10-15T19:00:00.000Z'),
    );
    store.events.set(
      laterId,
      row(laterId, 'Still ahead', '2026-12-01T18:00:00.000Z', '2026-12-01T21:00:00.000Z'),
    );
    store.events.set(
      todayId,
      row(todayId, 'Whole day today', '2026-10-18T07:00:00.000Z', '2026-10-18T07:00:00.000Z'),
    );
    store.events.set(
      yesterdayId,
      row(
        yesterdayId,
        'Whole day yesterday',
        '2026-10-17T07:00:00.000Z',
        '2026-10-17T07:00:00.000Z',
      ),
    );

    const listed = await app.request('/v1/events?lat=61.3037&lng=17.0592&radiusM=50000');
    const items = (await listed.json()) as { items: { id: string }[] };
    expect(items.items.map((item) => item.id).sort()).toEqual([laterId, todayId].sort());
  });

  it('omits a published event that has no point', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(store);
    const app = createApp({
      auth,
      events: createMemoryEventServices(auth, { now: () => new Date() }, store),
    });
    const placedId = '11111111-1111-4111-8111-111111111431';
    const taggedId = '11111111-1111-4111-8111-111111111432';
    const blankId = '11111111-1111-4111-8111-111111111433';
    const tagId = SEED_TAGS[0]!.id;
    const at = '2026-12-02T18:00:00.000Z';
    function put(
      id: string,
      title: string,
      location: { lat: number; lng: number } | null,
      tagIds: string[],
    ) {
      store.events.set(id, {
        id,
        publisherId: '11111111-1111-4111-8111-111111111403',
        title,
        description: null,
        mode: 'physical',
        status: 'published',
        origin: 'native',
        startsAt: at,
        endsAt: at,
        timezone: 'Europe/Stockholm',
        venueName: 'Hall',
        location,
        geofenceRadiusM: location ? 100 : null,
        onlineUrl: null,
        priceAmount: null,
        currency: 'SEK',
        publisherName: 'Hall',
        links: [],
        imageUrl: null,
        imageUrls: [],
        tagIds,
        featured: false,
        checkInEnabled: false,
        meta: {},
        numSaved: 0,
        numComing: 0,
        createdAt: at,
        updatedAt: at,
        startsAtDate: new Date(at),
        endsAtDate: new Date(at),
      });
    }
    put(placedId, 'Has a point', { lat: 61.3037, lng: 17.0592 }, []);
    put(taggedId, 'Tagged without a point', null, [tagId]);
    put(blankId, 'Neither point nor tag', null, []);

    const listed = await app.request('/v1/events?lat=61.3037&lng=17.0592&radiusM=50000&q=Neither');
    expect(listed.status).toBe(200);
    const searched = (await listed.json()) as { items: { id: string }[] };
    expect(searched.items).toEqual([]);

    const page = await app.request('/v1/events?lat=61.3037&lng=17.0592&radiusM=50000');
    const body = (await page.json()) as { items: { id: string }[] };
    expect(body.items.map((item) => item.id)).toEqual([placedId]);

    const detail = await app.request(`/v1/events/${blankId}`);
    expect(detail.status).toBe(200);
    const taggedDetail = await app.request(`/v1/events/${taggedId}`);
    expect(taggedDetail.status).toBe(200);
  });

  it('sorts popular events by saves plus coming marks', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(store);
    const app = createApp({
      auth,
      events: createMemoryEventServices(auth, { now: () => new Date() }, store),
    });
    const quietId = '11111111-1111-4111-8111-111111111411';
    const savedId = '11111111-1111-4111-8111-111111111412';
    const bothId = '11111111-1111-4111-8111-111111111413';
    const at = new Date('2026-06-01T00:00:00.000Z');
    function put(id: string, title: string, startsAt: string) {
      store.events.set(id, {
        id,
        publisherId: '11111111-1111-4111-8111-111111111403',
        title,
        description: null,
        mode: 'physical',
        status: 'published',
        origin: 'native',
        startsAt,
        endsAt: startsAt,
        timezone: 'Europe/Stockholm',
        venueName: 'Hall',
        location: { lat: 61.3037, lng: 17.0592 },
        geofenceRadiusM: 100,
        onlineUrl: null,
        priceAmount: null,
        currency: 'SEK',
        publisherName: 'Hall',
        links: [],
        imageUrl: null,
        imageUrls: [],
        tagIds: [],
        featured: id === quietId,
        checkInEnabled: false,
        meta: {},
        numSaved: 0,
        numComing: 0,
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
        startsAtDate: new Date(startsAt),
        endsAtDate: new Date(startsAt),
      });
    }
    put(quietId, 'Featured but quiet', '2026-12-01T18:00:00.000Z');
    put(savedId, 'Saved once', '2026-12-02T18:00:00.000Z');
    put(bothId, 'Saved and coming', '2026-12-20T18:00:00.000Z');
    store.stats.set(`event:${savedId}:numSaved`, { value: 1, createdAt: at, updatedAt: at });
    store.stats.set(`event:${bothId}:numSaved`, { value: 2, createdAt: at, updatedAt: at });
    store.stats.set(`event:${bothId}:numComing`, { value: 2, createdAt: at, updatedAt: at });

    const listed = await app.request(
      '/v1/events?lat=61.3037&lng=17.0592&radiusM=50000&sort=popular',
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      items: { id: string; numSaved: number; numComing: number; featured: boolean }[];
    };
    expect(body.items.map((item) => item.id)).toEqual([bothId, savedId]);
    expect(body.items[0]).toMatchObject({ numSaved: 2, numComing: 2, featured: false });
    expect(body.items[1]).toMatchObject({ numSaved: 1, numComing: 0 });

    const detail = await app.request(`/v1/events/${bothId}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: bothId, numSaved: 2, numComing: 2 });
  });

  it('returns gallery photos after the hero', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(store);
    const app = createApp({
      auth,
      events: createMemoryEventServices(auth, { now: () => new Date() }, store),
    });
    const id = '11111111-1111-4111-8111-111111111421';
    const at = '2026-06-01T18:00:00.000Z';
    store.events.set(id, {
      id,
      publisherId: '11111111-1111-4111-8111-111111111403',
      title: 'Gallery night',
      description: null,
      mode: 'physical',
      status: 'published',
      origin: 'native',
      startsAt: at,
      endsAt: at,
      timezone: 'Europe/Stockholm',
      venueName: 'Hall',
      location: { lat: 61.3037, lng: 17.0592 },
      geofenceRadiusM: 100,
      onlineUrl: null,
      priceAmount: null,
      currency: 'SEK',
      publisherName: 'Hall',
      links: [],
      imageUrl: 'https://images.example/hero.jpg',
      imageUrls: ['https://images.example/two.jpg', 'https://images.example/three.jpg'],
      tagIds: [],
      featured: false,
      checkInEnabled: false,
      meta: {},
      numSaved: 0,
      numComing: 0,
      createdAt: at,
      updatedAt: at,
      startsAtDate: new Date(at),
      endsAtDate: new Date(at),
    });

    const detail = await app.request(`/v1/events/${id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      imageUrl: 'https://images.example/hero.jpg',
      imageUrls: ['https://images.example/two.jpg', 'https://images.example/three.jpg'],
    });
  });

  it('lists published occasions that share a group and have not ended', async () => {
    const store = createMemoryStore();
    const now = new Date('2026-06-15T12:00:00.000Z');
    const auth = createMemoryAuthServices({ now: () => now }, store);
    const events = createMemoryEventServices(auth, { now: () => now }, store);
    const app = createApp({ auth, events });
    const group = 'cbis:2682743';
    const base = {
      publisherId: '11111111-1111-4111-8111-111111111403',
      description: null,
      mode: 'physical' as const,
      status: 'published' as const,
      origin: 'imported' as const,
      timezone: 'Europe/Stockholm',
      venueName: 'Hall',
      location: { lat: 61.3037, lng: 17.0592 },
      geofenceRadiusM: 100,
      onlineUrl: null,
      priceAmount: null,
      currency: 'SEK',
      publisherName: 'Hall',
      links: [],
      imageUrl: null,
      imageUrls: [],
      tagIds: [],
      featured: false,
      checkInEnabled: false,
      numSaved: 0,
      numComing: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    function row(
      id: string,
      title: string,
      startsAt: string,
      endsAt: string,
      meta: MemoryEventRow['meta'],
      status: MemoryEventRow['status'] = 'published',
    ): MemoryEventRow {
      return {
        ...base,
        id,
        title,
        status,
        startsAt,
        endsAt,
        meta,
        location: title === 'No pin' ? null : base.location,
        startsAtDate: new Date(startsAt),
        endsAtDate: new Date(endsAt),
      };
    }
    store.events.set(
      '11111111-1111-4111-8111-111111111501',
      row(
        '11111111-1111-4111-8111-111111111501',
        'Later',
        '2026-07-02T18:00:00.000Z',
        '2026-07-02T20:00:00.000Z',
        { occasionGroupId: group },
      ),
    );
    store.events.set(
      '11111111-1111-4111-8111-111111111502',
      row(
        '11111111-1111-4111-8111-111111111502',
        'Sooner',
        '2026-07-01T18:00:00.000Z',
        '2026-07-01T20:00:00.000Z',
        { occasionGroupId: group },
      ),
    );
    store.events.set(
      '11111111-1111-4111-8111-111111111503',
      row(
        '11111111-1111-4111-8111-111111111503',
        'Ended',
        '2026-06-01T18:00:00.000Z',
        '2026-06-01T20:00:00.000Z',
        { occasionGroupId: group },
      ),
    );
    store.events.set(
      '11111111-1111-4111-8111-111111111504',
      row(
        '11111111-1111-4111-8111-111111111504',
        'In review',
        '2026-07-03T18:00:00.000Z',
        '2026-07-03T20:00:00.000Z',
        { occasionGroupId: group },
        'in_review',
      ),
    );
    store.events.set(
      '11111111-1111-4111-8111-111111111505',
      row(
        '11111111-1111-4111-8111-111111111505',
        'Other group',
        '2026-07-01T12:00:00.000Z',
        '2026-07-01T14:00:00.000Z',
        { occasionGroupId: 'cbis:other' },
      ),
    );
    store.events.set(
      '11111111-1111-4111-8111-111111111506',
      row(
        '11111111-1111-4111-8111-111111111506',
        'No pin',
        '2026-07-04T18:00:00.000Z',
        '2026-07-04T20:00:00.000Z',
        { occasionGroupId: group },
      ),
    );

    const listed = await app.request(
      `/v1/events/occasions?occasionGroupId=${encodeURIComponent(group)}`,
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { items: { id: string; title: string }[] };
    expect(body.items.map((item) => item.title)).toEqual(['Sooner', 'Later', 'No pin']);

    const missing = await app.request('/v1/events/occasions');
    expect(missing.status).toBe(400);
  });

  it('counts the events the public list would show', async () => {
    const store = createMemoryStore();
    const now = new Date('2026-10-18T12:00:00.000Z');
    const auth = createMemoryAuthServices(store);
    const app = createApp({
      auth,
      events: createMemoryEventServices(auth, { now: () => now }, store),
    });
    const music = SEED_TAGS[0]!.id;
    const sport = SEED_TAGS[1]!.id;
    const base = {
      publisherId: '11111111-1111-4111-8111-111111111403',
      summary: null,
      description: null,
      mode: 'physical' as const,
      status: 'published' as const,
      origin: 'native' as const,
      timezone: 'Europe/Stockholm',
      venueName: 'Hall',
      location: { lat: 61.3037, lng: 17.0592 },
      geofenceRadiusM: 100,
      onlineUrl: null,
      priceAmount: null as number | null,
      currency: 'SEK',
      publisherName: 'Hall',
      links: [],
      imageUrl: null,
      imageUrls: [],
      tagIds: [] as string[],
      featured: false,
      checkInEnabled: false,
      meta: {},
      numSaved: 0,
      numComing: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    function row(
      id: string,
      title: string,
      startsAt: string,
      endsAt: string,
      extra: Partial<MemoryEventRow> = {},
    ): MemoryEventRow {
      return {
        ...base,
        id,
        title,
        startsAt,
        endsAt,
        startsAtDate: new Date(startsAt),
        endsAtDate: new Date(endsAt),
        ...extra,
      };
    }
    store.events.set(
      '11111111-1111-4111-8111-111111111601',
      row(
        '11111111-1111-4111-8111-111111111601',
        'Market',
        '2026-10-20T15:00:00.000Z',
        '2026-10-20T18:00:00.000Z',
        { tagIds: [music] },
      ),
    );
    store.events.set(
      '11111111-1111-4111-8111-111111111602',
      row(
        '11111111-1111-4111-8111-111111111602',
        'Match',
        '2026-10-21T15:00:00.000Z',
        '2026-10-21T18:00:00.000Z',
        { tagIds: [sport], priceAmount: 12_000 },
      ),
    );
    store.events.set(
      '11111111-1111-4111-8111-111111111603',
      row(
        '11111111-1111-4111-8111-111111111603',
        'Far away',
        '2026-10-22T15:00:00.000Z',
        '2026-10-22T18:00:00.000Z',
        { location: { lat: 59.3, lng: 18.07 } },
      ),
    );
    store.events.set(
      '11111111-1111-4111-8111-111111111604',
      row(
        '11111111-1111-4111-8111-111111111604',
        'No pin',
        '2026-10-22T15:00:00.000Z',
        '2026-10-22T18:00:00.000Z',
        { location: null },
      ),
    );
    store.events.set(
      '11111111-1111-4111-8111-111111111605',
      row(
        '11111111-1111-4111-8111-111111111605',
        'Ended',
        '2026-10-01T15:00:00.000Z',
        '2026-10-01T18:00:00.000Z',
      ),
    );

    const place = 'lat=61.3037&lng=17.0592&radiusM=50000';
    async function count(extra = '') {
      const res = await app.request(`/v1/events/count?${place}${extra}`);
      expect(res.status).toBe(200);
      return ((await res.json()) as { total: number }).total;
    }
    async function listed(extra = '') {
      const res = await app.request(`/v1/events?${place}${extra}`);
      expect(res.status).toBe(200);
      return ((await res.json()) as { items: unknown[] }).items.length;
    }

    expect(await count()).toBe(2);
    expect(await count()).toBe(await listed());
    expect(await count(`&tagIds=${music},${sport}`)).toBe(2);
    expect(await count(`&tagIds=${music}`)).toBe(1);
    expect(await count('&price=free')).toBe(1);
    expect(await count('&price=paid')).toBe(1);
    expect(await count('&q=market')).toBe(1);
    expect(await count(`&tagIds=${music}&price=paid`)).toBe(0);

    const missing = await app.request('/v1/events/count');
    expect(missing.status).toBe(400);
  });
});
