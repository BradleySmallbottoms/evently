import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { createMemoryEventServices } from '../../../apps/api/src/services/events/memory';
import { createMemoryStore } from '../../../apps/api/src/services/memory-store';
import { createMemorySubscriptionServices } from '../../../apps/api/src/services/subscriptions/memory';
import { SEED_CATEGORIES } from '../../../apps/api/src/services/events/seed-categories';
import { PUBLISHER_SESSION_COOKIE } from '../../../packages/auth/src/index';

async function createUserSession(app: ReturnType<typeof createApp>) {
  const created = await app.request('/v1/identities', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'ios', locale: 'sv' }),
  });
  expect(created.status).toBe(201);
  return (await created.json()) as { sessionToken: string };
}

async function registerVerifiedPublisher(app: ReturnType<typeof createApp>, store: ReturnType<typeof createMemoryStore>) {
  const registered = await app.request('/v1/publishers/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'sub-pub@example.com',
      password: 'long-enough-password',
      name: 'Follow Me',
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
    body: JSON.stringify({ email: 'sub-pub@example.com', password: 'long-enough-password' }),
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
  expect(cookie).toContain(PUBLISHER_SESSION_COOKIE);
  store.publishers.get(reg.publisherId)!.verified = true;
  return { publisherId: reg.publisherId, cookie };
}

describe('subscriptions', () => {
  it('documents OpenAPI paths', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/me/subscriptions']).toBeDefined();
    expect(doc.paths['/me/subscriptions/{targetType}/{targetId}']).toBeDefined();
  });

  it('follows and unfollows a publisher', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => new Date() }, store);
    const subscriptions = createMemorySubscriptionServices(auth, store);
    const app = createApp({ auth, events, subscriptions });

    const { publisherId } = await registerVerifiedPublisher(app, store);
    const session = await createUserSession(app);
    const authHeader = { authorization: `Bearer ${session.sessionToken}` };

    const created = await app.request('/v1/me/subscriptions', {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ targetType: 'publisher', targetId: publisherId }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      targetType: 'publisher',
      targetId: publisherId,
    });

    const list = await app.request('/v1/me/subscriptions', { headers: authHeader });
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(1);

    const removed = await app.request(`/v1/me/subscriptions/publisher/${publisherId}`, {
      method: 'DELETE',
      headers: authHeader,
    });
    expect(removed.status).toBe(204);

    const empty = await app.request('/v1/me/subscriptions', { headers: authHeader });
    expect(((await empty.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  it('rejects follow of unknown publisher', async () => {
    const app = createApp();
    const session = await createUserSession(app);
    const res = await app.request('/v1/me/subscriptions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetType: 'publisher',
        targetId: '00000000-0000-4000-8000-000000000099',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('can follow a published event', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => new Date() }, store);
    const subscriptions = createMemorySubscriptionServices(auth, store);
    const app = createApp({ auth, events, subscriptions });

    const { publisherId, cookie } = await registerVerifiedPublisher(app, store);
    const created = await app.request(`/v1/publishers/${publisherId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        title: 'Followable',
        mode: 'physical',
        startsAt: '2026-12-01T18:00:00.000Z',
        endsAt: '2026-12-01T21:00:00.000Z',
        location: { lat: 61.3037, lng: 17.0592 },
        categoryIds: [SEED_CATEGORIES[0]!.id],
      }),
    });
    const draft = (await created.json()) as { id: string };
    await app.request(`/v1/manage/events/${draft.id}/publish`, {
      method: 'POST',
      headers: { cookie },
    });

    const session = await createUserSession(app);
    const follow = await app.request('/v1/me/subscriptions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ targetType: 'event', targetId: draft.id }),
    });
    expect(follow.status).toBe(201);
  });
});
