import { PUBLISHER_SESSION_COOKIE } from '../../../packages/auth/src/index';
import { CreateEventRequest, HttpUrl } from '../../../packages/contracts/src/events';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { createMemoryEventServices } from '../../../apps/api/src/services/events/memory';
import { SEED_TAGS } from '../../../packages/db/src/seed-tags';
import { createMemoryDomainEventPublisher } from '../../../apps/api/src/services/domain-events/memory';
import { createMemoryLibraryServices } from '../../../apps/api/src/services/library/memory';
import { createMemoryStore } from '../../../apps/api/src/services/memory-store';

async function createUserSession(app: ReturnType<typeof createApp>) {
  const created = await app.request('/v1/identities', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'ios', locale: 'sv' }),
  });
  expect(created.status).toBe(201);
  return (await created.json()) as { sessionToken: string };
}

async function publishEvent(
  app: ReturnType<typeof createApp>,
  store: ReturnType<typeof createMemoryStore>,
) {
  const registered = await app.request('/v1/publishers/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'library-pub@example.com',
      password: 'long-enough-password',
      name: 'Library Org',
      type: 'org',
    }),
  });
  const reg = (await registered.json()) as { publisherId: string; verificationToken?: string };
  await app.request('/v1/publishers/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: reg.verificationToken }),
  });
  const login = await app.request('/v1/publishers/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'library-pub@example.com', password: 'long-enough-password' }),
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
  expect(cookie).toContain(PUBLISHER_SESSION_COOKIE);
  store.publishers.get(reg.publisherId)!.status = 'published';

  const startsAt = new Date('2026-11-14T16:00:00.000Z');
  const created = await app.request(`/v1/publishers/${reg.publisherId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      title: 'Trailrun vid Skärgårdsleden',
      mode: 'physical',
      startsAt: startsAt.toISOString(),
      endsAt: new Date('2026-11-14T18:00:00.000Z').toISOString(),
      location: { lat: 61.3037, lng: 17.0592 },
      venueName: 'Skärgårdsleden',
      priceAmount: 0,
      links: [{ type: 'registration', url: 'https://example.com/signup', label: 'Anmäl dig' }],
      tagIds: [SEED_TAGS[2]!.id],
    }),
  });
  expect(created.status).toBe(201);
  const draft = (await created.json()) as {
    id: string;
    publisherName: string;
    priceAmount: number | null;
    links: { type: string; url: string }[];
  };
  expect(draft.publisherName).toBe('Library Org');
  expect(draft.priceAmount).toBe(0);
  expect(draft.links[0]).toMatchObject({ type: 'registration', url: 'https://example.com/signup' });
  const published = await app.request(`/v1/manage/events/${draft.id}/publish`, {
    method: 'POST',
    headers: { cookie },
  });
  expect(published.status).toBe(200);
  return draft.id;
}

describe('saved events and lists', () => {
  it('accepts only http and https event links', () => {
    expect(HttpUrl.safeParse('https://example.com/tickets').success).toBe(true);
    expect(HttpUrl.safeParse('http://example.com/tickets').success).toBe(true);
    expect(HttpUrl.safeParse('javascript:alert(1)').success).toBe(false);
    expect(HttpUrl.safeParse('ftp://example.com/file').success).toBe(false);
    const bad = CreateEventRequest.safeParse({
      title: 'Bad link',
      mode: 'physical',
      startsAt: '2026-11-14T16:00:00.000Z',
      endsAt: '2026-11-14T18:00:00.000Z',
      location: { lat: 61.3, lng: 17.06 },
      links: [{ type: 'tickets', url: 'javascript:alert(1)' }],
    });
    expect(bad.success).toBe(false);
  });

  it('documents OpenAPI paths', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/me/saved-events']).toBeDefined();
    expect(doc.paths['/me/saved-events/{eventId}']).toBeDefined();
    expect(doc.paths['/me/coming-events']).toBeDefined();
    expect(doc.paths['/me/coming-events/{eventId}']).toBeDefined();
    expect(doc.paths['/me/lists']).toBeDefined();
    expect(doc.paths['/me/lists/{id}/events/{eventId}']).toBeDefined();
  });

  it('saves a published event and rejects an unknown one', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => new Date() }, store);
    const library = createMemoryLibraryServices(auth, store);
    const app = createApp({ auth, events, library });
    const eventId = await publishEvent(app, store);
    const session = await createUserSession(app);
    const headers = { authorization: `Bearer ${session.sessionToken}` };

    const saved = await app.request(`/v1/me/saved-events/${eventId}`, { method: 'PUT', headers });
    expect(saved.status).toBe(204);
    const again = await app.request(`/v1/me/saved-events/${eventId}`, { method: 'PUT', headers });
    expect(again.status).toBe(204);

    const list = await app.request('/v1/me/saved-events', { headers });
    const body = (await list.json()) as { items: { id: string; priceAmount: number | null }[] };
    expect(body.items.map((item) => item.id)).toEqual([eventId]);
    expect(body.items[0]?.priceAmount).toBe(0);

    const missing = await app.request('/v1/me/saved-events/11111111-1111-4111-8111-111111111199', {
      method: 'PUT',
      headers,
    });
    expect(missing.status).toBe(404);

    const removed = await app.request(`/v1/me/saved-events/${eventId}`, {
      method: 'DELETE',
      headers,
    });
    expect(removed.status).toBe(204);
    const empty = await app.request('/v1/me/saved-events', { headers });
    expect(((await empty.json()) as { items: unknown[] }).items).toHaveLength(0);
    const gone = await app.request(`/v1/me/saved-events/${eventId}`, { method: 'DELETE', headers });
    expect(gone.status).toBe(404);
  });

  it('marks coming once and emits a stats event only when the row changes', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => new Date() }, store);
    const domainEvents = createMemoryDomainEventPublisher();
    const library = createMemoryLibraryServices(auth, store, { domainEvents });
    const app = createApp({ auth, events, library });
    const eventId = await publishEvent(app, store);
    const session = await createUserSession(app);
    const headers = { authorization: `Bearer ${session.sessionToken}` };

    const marked = await app.request(`/v1/me/coming-events/${eventId}`, { method: 'PUT', headers });
    expect(marked.status).toBe(204);
    const again = await app.request(`/v1/me/coming-events/${eventId}`, { method: 'PUT', headers });
    expect(again.status).toBe(204);
    expect(domainEvents.events.filter((event) => event.type === 'event.coming')).toHaveLength(1);

    const list = await app.request('/v1/me/coming-events', { headers });
    expect(
      ((await list.json()) as { items: { id: string }[] }).items.map((item) => item.id),
    ).toEqual([eventId]);

    const removed = await app.request(`/v1/me/coming-events/${eventId}`, {
      method: 'DELETE',
      headers,
    });
    expect(removed.status).toBe(204);
    expect(domainEvents.events.at(-1)).toMatchObject({ type: 'event.coming_cleared', eventId });
    const empty = await app.request('/v1/me/coming-events', { headers });
    expect(((await empty.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  it('emits a save event only for a new bookmark', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => new Date() }, store);
    const domainEvents = createMemoryDomainEventPublisher();
    const library = createMemoryLibraryServices(auth, store, { domainEvents });
    const app = createApp({ auth, events, library });
    const eventId = await publishEvent(app, store);
    const session = await createUserSession(app);
    const headers = { authorization: `Bearer ${session.sessionToken}` };

    await app.request(`/v1/me/saved-events/${eventId}`, { method: 'PUT', headers });
    await app.request(`/v1/me/saved-events/${eventId}`, { method: 'PUT', headers });
    expect(domainEvents.events.filter((event) => event.type === 'event.saved')).toHaveLength(1);
    await app.request(`/v1/me/saved-events/${eventId}`, { method: 'DELETE', headers });
    expect(domainEvents.events.at(-1)).toMatchObject({ type: 'event.unsaved', eventId });
  });

  it('creates a list, adds the event, and enforces the list cap', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => new Date() }, store);
    const library = createMemoryLibraryServices(auth, store);
    const app = createApp({ auth, events, library });
    const eventId = await publishEvent(app, store);
    const session = await createUserSession(app);
    const headers = {
      authorization: `Bearer ${session.sessionToken}`,
      'content-type': 'application/json',
    };

    const created = await app.request('/v1/me/lists', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Helg' }),
    });
    expect(created.status).toBe(201);
    const list = (await created.json()) as { id: string };
    const added = await app.request(`/v1/me/lists/${list.id}/events/${eventId}`, {
      method: 'PUT',
      headers,
    });
    expect(added.status).toBe(204);
    const listed = await app.request('/v1/me/lists', { headers });
    const lists = (await listed.json()) as { items: { events: { id: string }[] }[] };
    expect(lists.items[0]?.events.map((event) => event.id)).toEqual([eventId]);

    for (let i = 0; i < 19; i += 1) {
      const extra = await app.request('/v1/me/lists', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: `Lista ${i}` }),
      });
      expect(extra.status).toBe(201);
    }
    const capped = await app.request('/v1/me/lists', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'För många' }),
    });
    expect(capped.status).toBe(409);
  });

  it('hides one user’s lists and saves from another user', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => new Date() }, store);
    const library = createMemoryLibraryServices(auth, store);
    const app = createApp({ auth, events, library });
    const eventId = await publishEvent(app, store);
    const owner = await createUserSession(app);
    const other = await createUserSession(app);
    const ownerHeaders = {
      authorization: `Bearer ${owner.sessionToken}`,
      'content-type': 'application/json',
    };
    const otherHeaders = {
      authorization: `Bearer ${other.sessionToken}`,
      'content-type': 'application/json',
    };

    const saved = await app.request(`/v1/me/saved-events/${eventId}`, {
      method: 'PUT',
      headers: ownerHeaders,
    });
    expect(saved.status).toBe(204);
    const created = await app.request('/v1/me/lists', {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ name: 'Helg' }),
    });
    expect(created.status).toBe(201);
    const list = (await created.json()) as { id: string };
    const added = await app.request(`/v1/me/lists/${list.id}/events/${eventId}`, {
      method: 'PUT',
      headers: ownerHeaders,
    });
    expect(added.status).toBe(204);

    const otherSaved = await app.request('/v1/me/saved-events', { headers: otherHeaders });
    expect(((await otherSaved.json()) as { items: unknown[] }).items).toHaveLength(0);
    const otherLists = await app.request('/v1/me/lists', { headers: otherHeaders });
    expect(((await otherLists.json()) as { items: unknown[] }).items).toHaveLength(0);

    const renamed = await app.request(`/v1/me/lists/${list.id}`, {
      method: 'PATCH',
      headers: otherHeaders,
      body: JSON.stringify({ name: 'Stulen' }),
    });
    expect(renamed.status).toBe(404);
    const injected = await app.request(`/v1/me/lists/${list.id}/events/${eventId}`, {
      method: 'PUT',
      headers: otherHeaders,
    });
    expect(injected.status).toBe(404);
    const removed = await app.request(`/v1/me/lists/${list.id}`, {
      method: 'DELETE',
      headers: otherHeaders,
    });
    expect(removed.status).toBe(404);

    const stillThere = await app.request('/v1/me/lists', { headers: ownerHeaders });
    const ownerLists = (await stillThere.json()) as {
      items: { id: string; name: string; events: { id: string }[] }[];
    };
    expect(ownerLists.items).toEqual([
      expect.objectContaining({
        id: list.id,
        name: 'Helg',
        events: [expect.objectContaining({ id: eventId })],
      }),
    ]);
  });

  it('filters the public list by price and text', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => new Date() }, store);
    const app = createApp({ auth, events });
    await publishEvent(app, store);
    const res = await app.request(
      '/v1/events?lat=61.3&lng=17.06&radiusM=50000&q=trailrun&price=free',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { title: string; publisherName: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.publisherName).toBe('Library Org');

    const paid = await app.request('/v1/events?lat=61.3&lng=17.06&radiusM=50000&price=paid');
    expect(((await paid.json()) as { items: unknown[] }).items).toHaveLength(0);
  });
});
