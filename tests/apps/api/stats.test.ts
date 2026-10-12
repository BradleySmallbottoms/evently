import { PUBLISHER_SESSION_COOKIE } from '../../../packages/auth/src/index';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { createMemoryCheckInServices } from '../../../apps/api/src/services/check-ins/memory';
import { createMemoryEventServices } from '../../../apps/api/src/services/events/memory';
import { SEED_TAGS } from '../../../packages/db/src/seed-tags';
import { createMemoryStore } from '../../../apps/api/src/services/memory-store';
import { createMemoryRatingServices } from '../../../apps/api/src/services/ratings/memory';
import { createMemoryStatsServices } from '../../../apps/api/src/services/stats/memory';

const WORKER = 'test-stats-worker-token';

describe('stats', () => {
  it('documents OpenAPI paths', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/stats/{sourceType}/{sourceId}']).toBeDefined();
  });

  it('PUT applies mutations; GET returns requested keys; remove does not clamp', async () => {
    const store = createMemoryStore();
    const now = new Date('2026-06-16T12:00:00.000Z');
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => now },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => now }, store);
    const checkIns = createMemoryCheckInServices(auth, { now: () => now }, store);
    const ratings = createMemoryRatingServices(auth, { now: () => now }, store);
    const stats = createMemoryStatsServices(auth, store, {
      workerToken: WORKER,
      now: () => now,
    });
    const app = createApp({ auth, events, checkIns, ratings, stats });

    const email = `stats-${now.getTime()}@example.com`;
    const registered = await app.request('/v1/publishers/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'long-enough-password',
        name: 'Stats Org',
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
      body: JSON.stringify({ email, password: 'long-enough-password' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
    expect(cookie).toContain(PUBLISHER_SESSION_COOKIE);
    store.publishers.get(reg.publisherId)!.verified = true;

    const created = await app.request(`/v1/publishers/${reg.publisherId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        title: 'Stats gig',
        mode: 'physical',
        startsAt: '2026-06-15T18:00:00.000Z',
        endsAt: '2026-06-15T21:00:00.000Z',
        location: { lat: 61.3037, lng: 17.0592 },
        geofenceRadiusM: 100,
        tagIds: [SEED_TAGS[0]!.id],
      }),
    });
    const draft = (await created.json()) as { id: string };
    await app.request(`/v1/manage/events/${draft.id}/publish`, {
      method: 'POST',
      headers: { cookie },
    });
    const eventId = draft.id;

    const denied = await app.request(`/v1/stats/event/${eventId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ key: 'numCheckins', add: 1 }]),
    });
    expect(denied.status).toBe(401);

    const put = await app.request(`/v1/stats/event/${eventId}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${WORKER}`,
      },
      body: JSON.stringify([
        { key: 'numCheckins', add: 1 },
        { key: 'numCheckins-2026-m06', add: 1 },
        { key: 'numCheckins-w25', add: 1 },
        { key: 'numRatings', add: 1 },
        { key: 'totalRatingValue', add: 5 },
      ]),
    });
    expect(put.status).toBe(200);

    const got = await app.request(
      `/v1/stats/event/${eventId}?key=numCheckins&key=numRatings&key=totalRatingValue&key=numCheckins-w25`,
    );
    expect(got.status).toBe(200);
    const body = (await got.json()) as { items: { key: string; value: number }[] };
    const map = Object.fromEntries(body.items.map((i) => [i.key, i.value]));
    expect(map).toMatchObject({
      numCheckins: 1,
      numRatings: 1,
      totalRatingValue: 5,
      'numCheckins-w25': 1,
    });

    const remove = await app.request(`/v1/stats/event/${eventId}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${WORKER}`,
      },
      body: JSON.stringify([{ key: 'numCheckins', remove: 3 }]),
    });
    expect(remove.status).toBe(200);
    const after = await app.request(`/v1/stats/event/${eventId}?key=numCheckins`);
    const afterBody = (await after.json()) as { items: { key: string; value: number }[] };
    expect(afterBody.items[0]?.value).toBe(-2);

    const identity = await app.request('/v1/identities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'ios', locale: 'sv' }),
    });
    const session = (await identity.json()) as { sessionToken: string; userId: string };

    await app.request(`/v1/stats/user/${session.userId}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${WORKER}`,
      },
      body: JSON.stringify([{ key: 'numEventsAttended', add: 1 }]),
    });

    const me = await app.request(
      `/v1/stats/user/${session.userId}?key=numEventsAttended`,
      { headers: { authorization: `Bearer ${session.sessionToken}` } },
    );
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      items: [expect.objectContaining({ key: 'numEventsAttended', value: 1 })],
    });
  });
});
