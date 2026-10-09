import { PUBLISHER_SESSION_COOKIE } from '@local-events/auth';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createMemoryAuthServices } from './services/auth/memory';
import { createMemoryEventServices, releaseAwaitingEventsInStore } from './services/events/memory';
import { SEED_CATEGORIES } from './services/events/seed-categories';
import { createMemoryStore } from './services/memory-store';

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
  categoryIds: [SEED_CATEGORIES[0]!.id],
};

describe('events', () => {
  it('lists seeded categories', async () => {
    const res = await createApp().request('/v1/categories');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { slug: string }[] };
    expect(body.items.some((c) => c.slug === 'music')).toBe(true);
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
    const events = createMemoryEventServices(auth, { now: () => new Date() }, store);
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

    const cancelled = await app.request(`/v1/manage/events/${draft.id}/cancel`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as { status: string }).status).toBe('cancelled');
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
});
