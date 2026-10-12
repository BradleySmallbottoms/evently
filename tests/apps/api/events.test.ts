import { PUBLISHER_SESSION_COOKIE } from '../../../packages/auth/src/index';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { createMemoryDomainEventPublisher } from '../../../apps/api/src/services/domain-events/memory';
import { createMemoryEventServices, releaseAwaitingEventsInStore } from '../../../apps/api/src/services/events/memory';
import { SEED_TAGS } from '../../../packages/db/src/seed-tags';
import { createMemoryStore, type MemoryEventRow } from '../../../apps/api/src/services/memory-store';

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
    expect(body.items.some((tag) => tag.slug === 'idrott-tavlingar' && tag.name === 'Idrott & Tävlingar')).toBe(
      true,
    );
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

    const publicBefore = await app.request(
      '/v1/events?lat=61.3037&lng=17.0592&radiusM=50000',
    );
    expect(publicBefore.status).toBe(200);
    expect(((await publicBefore.json()) as { items: unknown[] }).items).toHaveLength(0);

    const released = releaseAwaitingEventsInStore(store, publisherId, new Date());
    expect(released).toBe(1);

    const publicAfter = await app.request(
      '/v1/events?lat=61.3037&lng=17.0592&radiusM=50000',
    );
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
    const events = createMemoryEventServices(
      auth,
      { now: () => new Date(), domainEvents },
      store,
    );
    const app = createApp({ auth, events });

    const { publisherId, cookie } = await registerAndLogin(app, 'verified@example.com');
    const publisher = store.publishers.get(publisherId)!;
    publisher.verified = true;

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
    const events = createMemoryEventServices(
      auth,
      { now: () => new Date(), domainEvents },
      store,
    );
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
    const body = (await updated.json()) as { title: string; mode: string; onlineUrl: string | null };
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
      tagIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    function row(
      id: string,
      title: string,
      startsAt: string,
      featured: boolean,
    ): MemoryEventRow {
      return {
        ...base,
        id,
        title,
        startsAt,
        endsAt: startsAt,
        featured,
        checkInEnabled: false,
        startsAtDate: new Date(startsAt),
        endsAtDate: new Date(startsAt),
      };
    }
    store.events.set(
      soonerId,
      row(soonerId, 'Sooner', '2026-12-02T18:00:00.000Z', false),
    );
    store.events.set(
      featuredId,
      row(featuredId, 'Featured later', '2026-12-20T18:00:00.000Z', true),
    );

    const listed = await app.request('/v1/events?lat=61.3037&lng=17.0592&radiusM=50000');
    expect(listed.status).toBe(200);
    const items = (await listed.json()) as { items: { id: string; featured: boolean }[] };
    expect(items.items.map((item) => item.id)).toEqual([featuredId, soonerId]);
    expect(items.items[0]?.featured).toBe(true);
  });
});
