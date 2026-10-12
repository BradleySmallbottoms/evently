import { PUBLISHER_SESSION_COOKIE } from '../../../packages/auth/src/index';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { createMemoryCheckInServices } from '../../../apps/api/src/services/check-ins/memory';
import { createMemoryEventServices } from '../../../apps/api/src/services/events/memory';
import { SEED_TAGS } from '../../../packages/db/src/seed-tags';
import { createMemoryStore } from '../../../apps/api/src/services/memory-store';
import { createMemoryPreferenceServices } from '../../../apps/api/src/services/preferences/memory';
import { createMemoryRatingServices } from '../../../apps/api/src/services/ratings/memory';
import { createMemoryDomainEventPublisher } from '../../../apps/api/src/services/domain-events/memory';

async function createUserSession(app: ReturnType<typeof createApp>) {
  const created = await app.request('/v1/identities', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'ios', locale: 'sv' }),
  });
  expect(created.status).toBe(201);
  return (await created.json()) as { sessionToken: string; userId: string };
}

describe('ratings', () => {
  it('documents OpenAPI paths', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/events/{eventId}/rating']).toBeDefined();
    expect(doc.paths['/events/{eventId}/ratings']).toBeDefined();
    expect(doc.paths['/manage/events/{eventId}/ratings']).toBeDefined();
  });

  it('accepts a score after check-in in the rating window; comments need a named profile', async () => {
    const store = createMemoryStore();
    // Event already ended so rating window is open
    const now = new Date('2026-06-16T10:00:00.000Z');
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => now },
      store,
    );
    const domainEvents = createMemoryDomainEventPublisher();
    const events = createMemoryEventServices(auth, { now: () => now }, store);
    const checkIns = createMemoryCheckInServices(
      auth,
      { now: () => now, domainEvents },
      store,
    );
    const preferences = createMemoryPreferenceServices(auth, { now: () => now }, store);
    const ratings = createMemoryRatingServices(
      auth,
      { now: () => now, domainEvents },
      store,
    );
    const app = createApp({ auth, events, checkIns, preferences, ratings });

    const email = `rate-${now.getTime()}@example.com`;
    const registered = await app.request('/v1/publishers/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'long-enough-password',
        name: 'Rate Org',
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
        title: 'Past gig',
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

    const session = await createUserSession(app);
    const authHeader = {
      authorization: `Bearer ${session.sessionToken}`,
      'content-type': 'application/json',
    };

    // Event already ended — seed a prior check-in directly
    store.checkIns.push({
      id: '00000000-0000-4000-8000-000000000099',
      userId: session.userId,
      eventId,
      method: 'geo',
      lat: 61.3,
      lng: 17.05,
      accuracyM: 10,
      createdAt: new Date('2026-06-15T19:00:00.000Z'),
    });

    const status = await app.request(`/v1/events/${eventId}/rating`, {
      headers: { authorization: `Bearer ${session.sessionToken}` },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ canRate: true, hasRated: false });

    const withComment = await app.request(`/v1/events/${eventId}/ratings`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({ score: 5, comment: 'Great' }),
    });
    expect(withComment.status).toBe(400);
    expect(((await withComment.json()) as { error: { code: string } }).error.code).toBe(
      'comment_not_allowed',
    );

    await app.request('/v1/me/profile', {
      method: 'PUT',
      headers: authHeader,
      body: JSON.stringify({ choice: 'named', displayName: 'Mia' }),
    });

    const ok = await app.request(`/v1/events/${eventId}/ratings`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({ score: 4, comment: 'Nice night' }),
    });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ score: 4, comment: null });

    const managed = await app.request(`/v1/manage/events/${eventId}/ratings`, {
      headers: { cookie },
    });
    expect(managed.status).toBe(200);
    const list = (await managed.json()) as {
      items: { comment: string | null; displayName: string | null }[];
      aggregate: { average: number; count: number };
    };
    expect(list.aggregate).toEqual({ average: 4, count: 1 });
    expect(list.items[0]).toMatchObject({
      comment: 'Nice night',
      displayName: 'Mia',
    });
  });
});
