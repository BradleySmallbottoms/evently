import { PUBLISHER_SESSION_COOKIE } from '../../../packages/auth/src/index';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { createMemoryCheckInServices } from '../../../apps/api/src/services/check-ins/memory';
import { createMemoryDomainEventPublisher } from '../../../apps/api/src/services/domain-events/memory';
import { createMemoryEventServices } from '../../../apps/api/src/services/events/memory';
import { SEED_CATEGORIES } from '../../../apps/api/src/services/events/seed-categories';
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

async function publishPhysicalEvent(
  app: ReturnType<typeof createApp>,
  store: ReturnType<typeof createMemoryStore>,
  startsAt: Date,
  endsAt: Date,
) {
  const registered = await app.request('/v1/publishers/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `checkin-${startsAt.getTime()}@example.com`,
      password: 'long-enough-password',
      name: 'Venue Org',
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
    body: JSON.stringify({
      email: `checkin-${startsAt.getTime()}@example.com`,
      password: 'long-enough-password',
    }),
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
  expect(cookie).toContain(PUBLISHER_SESSION_COOKIE);
  store.publishers.get(reg.publisherId)!.verified = true;

  const created = await app.request(`/v1/publishers/${reg.publisherId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      title: 'Check-in gig',
      mode: 'physical',
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      location: { lat: 61.3037, lng: 17.0592 },
      geofenceRadiusM: 100,
      categoryIds: [SEED_CATEGORIES[0]!.id],
    }),
  });
  const draft = (await created.json()) as { id: string };
  await app.request(`/v1/manage/events/${draft.id}/publish`, {
    method: 'POST',
    headers: { cookie },
  });
  return draft.id;
}

describe('geo check-in', () => {
  it('documents OpenAPI paths', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/events/{eventId}/check-in']).toBeDefined();
    expect(doc.paths['/events/{eventId}/check-ins']).toBeDefined();
  });

  it('checks in when inside the geofence and window', async () => {
    const store = createMemoryStore();
    const now = new Date('2026-06-15T18:00:00.000Z');
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
    const app = createApp({ auth, events, checkIns });

    const eventId = await publishPhysicalEvent(
      app,
      store,
      new Date('2026-06-15T18:10:00.000Z'),
      new Date('2026-06-15T21:00:00.000Z'),
    );
    const session = await createUserSession(app);
    const authHeader = { authorization: `Bearer ${session.sessionToken}` };

    const status = await app.request(`/v1/events/${eventId}/check-in`, {
      headers: authHeader,
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ checkedIn: false, open: true });

    const res = await app.request(`/v1/events/${eventId}/check-ins`, {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        location: { lat: 61.3037, lng: 17.0592 },
        accuracyM: 20,
      }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ eventId, method: 'geo' });
    expect(domainEvents.events).toEqual([
      expect.objectContaining({ type: 'checkin.created', eventId }),
    ]);

    const again = await app.request(`/v1/events/${eventId}/check-ins`, {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        location: { lat: 61.3037, lng: 17.0592 },
        accuracyM: 20,
      }),
    });
    expect(again.status).toBe(409);
  });

  it('rejects outside geofence and poor accuracy', async () => {
    const store = createMemoryStore();
    const now = new Date('2026-06-15T18:00:00.000Z');
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => now },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => now }, store);
    const checkIns = createMemoryCheckInServices(auth, { now: () => now }, store);
    const app = createApp({ auth, events, checkIns });

    const eventId = await publishPhysicalEvent(
      app,
      store,
      new Date('2026-06-15T18:10:00.000Z'),
      new Date('2026-06-15T21:00:00.000Z'),
    );
    const session = await createUserSession(app);
    const authHeader = {
      authorization: `Bearer ${session.sessionToken}`,
      'content-type': 'application/json',
    };

    const far = await app.request(`/v1/events/${eventId}/check-ins`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        location: { lat: 59.33, lng: 18.06 },
        accuracyM: 10,
      }),
    });
    expect(far.status).toBe(400);
    expect(((await far.json()) as { error: { code: string } }).error.code).toBe(
      'outside_geofence',
    );

    const poor = await app.request(`/v1/events/${eventId}/check-ins`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        location: { lat: 61.3037, lng: 17.0592 },
        accuracyM: 250,
      }),
    });
    expect(poor.status).toBe(400);
    expect(((await poor.json()) as { error: { code: string } }).error.code).toBe(
      'poor_accuracy',
    );
  });
});
