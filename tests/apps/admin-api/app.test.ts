import { generateTotpCode, hashPassword } from '../../../packages/auth/src/index';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/admin-api/src/app';
import {
  createMemoryAdminPushMessageServices,
  type AdminPushEventRef,
} from '../../../apps/admin-api/src/services/push-messages';
import type { PushMessage } from '../../../packages/contracts/src/push-messages';
import {
  createAdminMemoryAuthStore,
  createMemoryAdminAuthServices,
} from '../../../apps/admin-api/src/services/auth/memory';
import { createMemoryDomainEventPublisher } from '../../../apps/admin-api/src/services/domain-events/memory';
import { createMemoryAdminPublisherServices } from '../../../apps/admin-api/src/services/publishers';

async function seededAuth() {
  const store = createAdminMemoryAuthStore();
  const passwordHash = await hashPassword('admin-password-long');
  store.admins.set('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'admin@example.com',
    passwordHash,
    totpSecret: 'JBSWY3DPEHPK3PXP',
    role: 'admin',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  });
  const auth = createMemoryAdminAuthServices(store, {
    now: () => new Date('2026-06-15T12:00:00.000Z'),
  });
  return { store, auth };
}

async function loginSession(app: ReturnType<typeof createApp>) {
  const login = await app.request('/v1/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'admin-password-long' }),
  });
  expect(login.status).toBe(200);
  const challenge = (await login.json()) as { status: string; challengeToken: string };
  expect(challenge.status).toBe('totp_required');
  const code = generateTotpCode('JBSWY3DPEHPK3PXP', Date.parse('2026-06-15T12:00:00.000Z'));
  const totp = await app.request('/v1/admin/login/totp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: challenge.challengeToken, code }),
  });
  expect(totp.status).toBe(200);
  const cookie = (totp.headers.get('set-cookie') ?? '').split(';')[0]!;
  expect(cookie).toContain('le_admin_session=');
  return cookie;
}

describe('admin api', () => {
  it('responds on /health', async () => {
    const res = await createApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'admin-api' });
  });

  it('serves OpenAPI with auth and publisher routes', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/admin/login']).toBeDefined();
    expect(doc.paths['/admin/login/totp']).toBeDefined();
    expect(doc.paths['/admin/login/otp']).toBeDefined();
    expect(doc.paths['/admin/login/otp/confirm']).toBeDefined();
    expect(doc.paths['/publishers']).toBeDefined();
    expect(doc.paths['/publishers/{id}/verify']).toBeDefined();
    expect(doc.paths['/publishers/{id}/map']).toBeDefined();
    expect(doc.paths['/publishers/{id}/complete']).toBeDefined();
    expect(doc.paths['/publishers/{id}/events']).toBeDefined();
    expect((doc.paths['/publishers/{id}'] as { delete?: unknown }).delete).toBeDefined();
    expect(doc.paths['/events']).toBeDefined();
    expect(doc.paths['/events/workers']).toBeDefined();
    expect(doc.paths['/events/{id}']).toBeDefined();
    expect(doc.paths['/tags']).toBeDefined();
    expect(doc.paths['/events/{id}/sent-notifications']).toBeDefined();
    expect(doc.paths['/events/{id}/approve']).toBeDefined();
    expect(doc.paths['/events/{id}/reject']).toBeDefined();
    expect(doc.paths['/events/{id}/rescan']).toBeDefined();
    expect(doc.paths['/events/{id}/occasion-group']).toBeDefined();
    expect(doc.paths['/events/{id}/collapse']).toBeDefined();
    expect(doc.paths['/events/{id}/possible-duplicates']).toBeDefined();
    expect(doc.paths['/events/{id}/merge-duplicates']).toBeDefined();
    expect(doc.paths['/events/{id}/poster']).toBeDefined();
    expect((doc.paths['/events/{id}/poster'] as { delete?: unknown }).delete).toBeDefined();
    expect((doc.paths['/events/{id}'] as { delete?: unknown }).delete).toBeDefined();
    expect(doc.paths['/data-sources']).toBeDefined();
    expect(doc.paths['/data-sources/{id}/runs']).toBeDefined();
    expect(doc.paths['/data-sources/{id}/run']).toBeDefined();
  });

  it('rejects publisher list without session', async () => {
    const { auth } = await seededAuth();
    const app = createApp({ auth });
    const list = await app.request('/v1/publishers?status=in_review');
    expect(list.status).toBe(401);
  });

  it('logs in with password + TOTP and verifies publishers', async () => {
    const { auth } = await seededAuth();
    const publishers = new Map([
      [
        '22222222-2222-4222-8222-222222222201',
        {
          id: '22222222-2222-4222-8222-222222222201',
          name: 'Cafe',
          slug: 'cafe',
          type: 'org' as const,
          status: 'in_review',
          origin: 'native' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    ]);
    const events = new Map([
      [
        '33333333-3333-4333-8333-333333333301',
        {
          id: '33333333-3333-4333-8333-333333333301',
          publisherId: '22222222-2222-4222-8222-222222222201',
          status: 'awaiting_verification',
          endsAtDate: new Date('2026-12-01T21:00:00Z'),
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    ]);
    const domainEvents = createMemoryDomainEventPublisher();
    const app = createApp({
      auth,
      publishers: createMemoryAdminPublisherServices({ publishers, events }, { domainEvents }),
    });

    const cookie = await loginSession(app);

    const list = await app.request('/v1/publishers?status=in_review', {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      items: [{ id: '22222222-2222-4222-8222-222222222201', eventCount: 1 }],
    });

    const verify = await app.request('/v1/publishers/22222222-2222-4222-8222-222222222201/verify', {
      method: 'POST',
      headers: { cookie },
    });
    expect(verify.status).toBe(200);
    expect(await verify.json()).toMatchObject({
      status: 'published',
      releasedEventCount: 1,
    });
    expect(events.get('33333333-3333-4333-8333-333333333301')?.status).toBe('published');
    expect(domainEvents.events).toEqual([
      {
        type: 'event.published',
        eventId: '33333333-3333-4333-8333-333333333301',
      },
    ]);
  });

  it('saves a publisher notification plan and schedules it when the publisher is verified', async () => {
    const { auth } = await seededAuth();
    const publishers = new Map([
      [
        '22222222-2222-4222-8222-222222222201',
        {
          id: '22222222-2222-4222-8222-222222222201',
          name: 'Cafe',
          slug: 'cafe',
          type: 'org' as const,
          status: 'published',
          origin: 'imported' as const,
          importNotificationPlan: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    ]);
    const events = new Map([
      [
        '33333333-3333-4333-8333-333333333301',
        {
          id: '33333333-3333-4333-8333-333333333301',
          publisherId: '22222222-2222-4222-8222-222222222201',
          status: 'published',
          origin: 'imported' as const,
          title: 'Jazzkväll',
          startsAtDate: new Date('2026-07-01T18:00:00.000Z'),
          endsAtDate: new Date('2026-07-01T21:00:00.000Z'),
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    ]);
    const store = {
      publishers,
      events,
      scheduledImports: [] as {
        eventId: string;
        planId: string;
        offsets: string[];
        status: 'pending' | 'approved';
      }[],
    };
    const app = createApp({
      auth,
      publishers: createMemoryAdminPublisherServices(store, {
        now: () => new Date('2026-06-15T12:00:00.000Z'),
      }),
    });
    const cookie = await loginSession(app);
    const saved = await app.request('/v1/publishers/22222222-2222-4222-8222-222222222201', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ importNotificationPlan: 'standard' }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ importNotificationPlan: 'standard' });
    expect(store.scheduledImports).toEqual([
      {
        eventId: '33333333-3333-4333-8333-333333333301',
        planId: 'standard',
        offsets: ['week', 'day'],
        status: 'approved',
      },
    ]);

    const again = await app.request('/v1/publishers/22222222-2222-4222-8222-222222222201', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ importNotificationPlan: 'full' }),
    });
    expect(again.status).toBe(200);
    expect(store.scheduledImports).toHaveLength(1);

    const cleared = await app.request('/v1/publishers/22222222-2222-4222-8222-222222222201', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ importNotificationPlan: null }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ importNotificationPlan: null });
  });

  it('lists a publisher’s events and deletes the publisher only when it has none', async () => {
    const { auth } = await seededAuth();
    const emptyId = '22222222-2222-4222-8222-222222222202';
    const busyId = '22222222-2222-4222-8222-222222222201';
    const publishers = new Map([
      [
        emptyId,
        {
          id: emptyId,
          name: 'Tomt',
          slug: 'tomt',
          type: 'org' as const,
          status: 'in_review' as const,
          origin: 'imported' as const,
          importNotificationPlan: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      [
        busyId,
        {
          id: busyId,
          name: 'Cafe',
          slug: 'cafe',
          type: 'org' as const,
          status: 'published' as const,
          origin: 'imported' as const,
          importNotificationPlan: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    ]);
    const events = new Map([
      [
        '33333333-3333-4333-8333-333333333301',
        {
          id: '33333333-3333-4333-8333-333333333301',
          publisherId: busyId,
          status: 'published',
          title: 'Jazzkväll',
          venueName: 'Scen',
          startsAtDate: new Date('2026-07-01T18:00:00.000Z'),
          endsAtDate: new Date('2026-07-01T21:00:00.000Z'),
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    ]);
    const aliases = new Map([
      ['alias-1', { sourceId: 'src', externalOrganizerKey: 'tomt.se', publisherId: emptyId }],
    ]);
    const app = createApp({
      auth,
      publishers: createMemoryAdminPublisherServices({ publishers, events, aliases }),
    });
    const cookie = await loginSession(app);

    const empty = await app.request(`/v1/publishers/${emptyId}/events`, { headers: { cookie } });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ items: [], total: 0 });

    const listed = await app.request(`/v1/publishers/${busyId}/events`, { headers: { cookie } });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      total: 1,
      items: [
        {
          id: '33333333-3333-4333-8333-333333333301',
          title: 'Jazzkväll',
          status: 'published',
          startsAt: '2026-07-01T18:00:00.000Z',
          endsAt: '2026-07-01T21:00:00.000Z',
          venueName: 'Scen',
        },
      ],
    });

    const blocked = await app.request(`/v1/publishers/${busyId}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(blocked.status).toBe(409);
    expect(publishers.has(busyId)).toBe(true);

    const removed = await app.request(`/v1/publishers/${emptyId}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ id: emptyId });
    expect(publishers.has(emptyId)).toBe(false);
    expect(aliases.size).toBe(0);

    const missing = await app.request(`/v1/publishers/${emptyId}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(missing.status).toBe(404);
  });

  it('approves and rejects imported events in review', async () => {
    const { auth } = await seededAuth();
    const eventStore = {
      publishers: new Map([
        [
          '22222222-2222-4222-8222-222222222201',
          { id: '22222222-2222-4222-8222-222222222201', name: 'Imported Band' },
        ],
      ]),
      events: new Map([
        [
          '44444444-4444-4444-8444-444444444401',
          {
            id: '44444444-4444-4444-8444-444444444401',
            publisherId: '22222222-2222-4222-8222-222222222201',
            title: 'Concert',
            mode: 'physical' as const,
            status: 'in_review',
            origin: 'imported' as const,
            startsAt: '2026-07-01T18:00:00.000Z',
            endsAt: '2026-07-01T21:00:00.000Z',
            venueName: 'Arena',
            sourceUrl: 'https://example.com',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      ]),
    };
    const domainEvents = createMemoryDomainEventPublisher();
    const { createMemoryAdminEventServices } =
      await import('../../../apps/admin-api/src/services/events');
    const app = createApp({
      auth,
      events: createMemoryAdminEventServices(eventStore, { domainEvents }),
    });
    const cookie = await loginSession(app);

    const list = await app.request('/v1/events?status=in_review', { headers: { cookie } });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(1);

    const approve = await app.request('/v1/events/44444444-4444-4444-8444-444444444401/approve', {
      method: 'POST',
      headers: { cookie },
    });
    expect(approve.status).toBe(200);
    expect(await approve.json()).toMatchObject({ status: 'published' });
    expect(eventStore.events.get('44444444-4444-4444-8444-444444444401')?.status).toBe('published');
    expect(domainEvents.events).toEqual([
      { type: 'event.published', eventId: '44444444-4444-4444-8444-444444444401' },
    ]);
  });

  it('sends an imported review or published event back to the scan and refuses other rows', async () => {
    const { auth } = await seededAuth();
    const importedId = '44444444-4444-4444-8444-444444444401';
    const publishedId = '44444444-4444-4444-8444-444444444402';
    const nativeId = '44444444-4444-4444-8444-444444444403';
    const eventStore = {
      publishers: new Map([
        [
          '22222222-2222-4222-8222-222222222201',
          { id: '22222222-2222-4222-8222-222222222201', name: 'Imported Band' },
        ],
      ]),
      events: new Map([
        [
          importedId,
          {
            id: importedId,
            publisherId: '22222222-2222-4222-8222-222222222201',
            title: 'Concert',
            mode: 'physical' as const,
            status: 'in_review',
            origin: 'imported' as const,
            startsAt: '2026-07-01T18:00:00.000Z',
            endsAt: '2026-07-01T21:00:00.000Z',
            venueName: 'Arena',
            sourceUrl: 'https://example.com',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        [
          publishedId,
          {
            id: publishedId,
            publisherId: '22222222-2222-4222-8222-222222222201',
            title: 'Already out',
            mode: 'physical' as const,
            status: 'published',
            origin: 'imported' as const,
            startsAt: '2026-07-02T18:00:00.000Z',
            endsAt: '2026-07-02T21:00:00.000Z',
            venueName: 'Arena',
            sourceUrl: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        [
          nativeId,
          {
            id: nativeId,
            publisherId: '22222222-2222-4222-8222-222222222201',
            title: 'Local night',
            mode: 'physical' as const,
            status: 'in_review',
            origin: 'native' as const,
            startsAt: '2026-07-03T18:00:00.000Z',
            endsAt: '2026-07-03T21:00:00.000Z',
            venueName: 'Arena',
            sourceUrl: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      ]),
    };
    const { createMemoryAdminEventServices } =
      await import('../../../apps/admin-api/src/services/events');
    const app = createApp({
      auth,
      events: createMemoryAdminEventServices(eventStore),
    });
    const cookie = await loginSession(app);

    const denied = await app.request(`/v1/events/${importedId}/rescan`, { method: 'POST' });
    expect(denied.status).toBe(401);

    const published = await app.request(`/v1/events/${publishedId}/rescan`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({ id: publishedId, status: 'pending_scan' });
    expect(eventStore.events.get(publishedId)?.status).toBe('pending_scan');

    const native = await app.request(`/v1/events/${nativeId}/rescan`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(native.status).toBe(404);
    expect(eventStore.events.get(nativeId)?.status).toBe('in_review');

    const queued = await app.request(`/v1/events/${importedId}/rescan`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(queued.status).toBe(200);
    expect(await queued.json()).toMatchObject({ id: importedId, status: 'pending_scan' });
    expect(eventStore.events.get(importedId)?.status).toBe('pending_scan');

    const again = await app.request(`/v1/events/${importedId}/rescan`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(again.status).toBe(404);
  });

  it('collapses checked events that share a scan occasion group into the open event', async () => {
    const { auth } = await seededAuth();
    const hostId = '44444444-4444-4444-8444-444444444401';
    const earlyId = '44444444-4444-4444-8444-444444444402';
    const lateId = '44444444-4444-4444-8444-444444444403';
    const otherId = '44444444-4444-4444-8444-444444444404';
    const publisherId = '22222222-2222-4222-8222-222222222201';
    const base = {
      publisherId,
      mode: 'physical' as const,
      status: 'published' as const,
      origin: 'imported' as const,
      venueName: 'Hall',
      sourceUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const eventStore = {
      publishers: new Map([[publisherId, { id: publisherId, name: 'Band' }]]),
      events: new Map([
        [
          hostId,
          {
            ...base,
            id: hostId,
            title: 'Host',
            startsAt: '2026-08-02T16:00:00.000Z',
            endsAt: '2026-08-02T18:00:00.000Z',
            meta: { possibleOccasionGroupId: 'product-1', freeEntry: true },
          },
        ],
        [
          earlyId,
          {
            ...base,
            id: earlyId,
            title: 'Early',
            startsAt: '2026-08-01T10:00:00.000Z',
            endsAt: '2026-08-01T12:00:00.000Z',
            venueName: 'Park',
            meta: { possibleOccasionGroupId: 'product-1' },
          },
        ],
        [
          lateId,
          {
            ...base,
            id: lateId,
            title: 'Late',
            startsAt: '2026-08-04T19:00:00.000Z',
            endsAt: '2026-08-04T21:00:00.000Z',
            venueName: null,
            meta: { possibleOccasionGroupId: 'product-1' },
          },
        ],
        [
          otherId,
          {
            ...base,
            id: otherId,
            title: 'Other product',
            startsAt: '2026-08-03T19:00:00.000Z',
            endsAt: '2026-08-03T21:00:00.000Z',
            meta: { possibleOccasionGroupId: 'product-2' },
          },
        ],
      ]),
    };
    const domainEvents = createMemoryDomainEventPublisher();
    const { createMemoryAdminEventServices } =
      await import('../../../apps/admin-api/src/services/events');
    const app = createApp({
      auth,
      events: createMemoryAdminEventServices(eventStore, { domainEvents }),
    });
    const cookie = await loginSession(app);

    const denied = await app.request(`/v1/events/${hostId}/occasion-group`);
    expect(denied.status).toBe(401);

    const group = await app.request(`/v1/events/${hostId}/occasion-group`, {
      headers: { cookie },
    });
    expect(group.status).toBe(200);
    const listed = (await group.json()) as { items: { id: string }[] };
    expect(listed.items.map((item) => item.id)).toEqual([earlyId, hostId, lateId]);

    const wrong = await app.request(`/v1/events/${hostId}/collapse`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ eventIds: [otherId] }),
    });
    expect(wrong.status).toBe(400);

    const collapsed = await app.request(`/v1/events/${hostId}/collapse`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ eventIds: [lateId, earlyId] }),
    });
    expect(collapsed.status).toBe(200);
    expect(await collapsed.json()).toMatchObject({
      id: hostId,
      startsAt: '2026-08-01T10:00:00.000Z',
      endsAt: '2026-08-04T21:00:00.000Z',
      venueName: 'Park',
      meta: { freeEntry: true },
      occasions: [
        {
          startsAt: '2026-08-01T10:00:00.000Z',
          endsAt: '2026-08-01T12:00:00.000Z',
          venueName: 'Park',
        },
        {
          startsAt: '2026-08-02T16:00:00.000Z',
          endsAt: '2026-08-02T18:00:00.000Z',
          venueName: 'Hall',
        },
        {
          startsAt: '2026-08-04T19:00:00.000Z',
          endsAt: '2026-08-04T21:00:00.000Z',
          venueName: 'Hall',
        },
      ],
    });
    expect(eventStore.events.get(hostId)?.meta).not.toHaveProperty('possibleOccasionGroupId');
    expect(eventStore.events.get(earlyId)).toBeUndefined();
    expect(eventStore.events.get(lateId)).toBeUndefined();
    expect(eventStore.events.get(otherId)?.status).toBe('published');
    expect(domainEvents.events).toEqual([
      { type: 'event.updated', eventId: hostId, changedFields: ['occasions'] },
    ]);

    const after = await app.request(`/v1/events/${hostId}/occasion-group`, { headers: { cookie } });
    expect(await after.json()).toMatchObject({ items: [] });
  });

  it('hides a possible duplicate without moving its occasions', async () => {
    const { auth } = await seededAuth();
    const hostId = '44444444-4444-4444-8444-444444444401';
    const matchId = '44444444-4444-4444-8444-444444444402';
    const incomingId = '44444444-4444-4444-8444-444444444403';
    const otherId = '44444444-4444-4444-8444-444444444404';
    const publisherId = '22222222-2222-4222-8222-222222222201';
    const hostOccasion = {
      id: '66666666-6666-4666-8666-666666666601',
      startsAt: '2026-08-02T16:00:00.000Z',
      endsAt: '2026-08-02T18:00:00.000Z',
      venueName: 'Hall',
      location: null,
    };
    const matchOccasions = [
      {
        id: '66666666-6666-4666-8666-666666666602',
        startsAt: '2026-08-01T10:00:00.000Z',
        endsAt: '2026-08-01T12:00:00.000Z',
        venueName: 'Park',
        location: null,
      },
      {
        id: '66666666-6666-4666-8666-666666666603',
        startsAt: '2026-08-03T10:00:00.000Z',
        endsAt: '2026-08-03T12:00:00.000Z',
        venueName: 'Square',
        location: null,
      },
    ];
    const base = {
      publisherId,
      mode: 'physical' as const,
      status: 'in_review' as const,
      origin: 'imported' as const,
      venueName: 'Hall',
      sourceUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const duplicate = {
      eventId: matchId,
      title: 'Match',
      startsAt: '2026-08-01T10:00:00.000Z',
      refId: 'src-1',
      workerId: 'visit-soderhamn',
      matchedOn: 'title' as const,
    };
    const eventStore = {
      publishers: new Map([[publisherId, { id: publisherId, name: 'Band' }]]),
      events: new Map([
        [
          hostId,
          {
            ...base,
            id: hostId,
            title: 'Host',
            startsAt: '2026-08-02T16:00:00.000Z',
            endsAt: '2026-08-02T18:00:00.000Z',
            occasions: [hostOccasion],
            meta: { possibleDuplicate: duplicate, freeEntry: true },
          },
        ],
        [
          matchId,
          {
            ...base,
            id: matchId,
            title: 'Match',
            status: 'published' as const,
            startsAt: '2026-08-01T10:00:00.000Z',
            endsAt: '2026-08-03T12:00:00.000Z',
            venueName: 'Park',
            workerId: 'visit-soderhamn',
            occasions: matchOccasions,
            meta: {
              freeEntry: true,
              address: { address: 'Promenaden 5', zipCode: '82433', city: 'Hudiksvall' },
            },
          },
        ],
        [
          incomingId,
          {
            ...base,
            id: incomingId,
            title: 'Incoming',
            startsAt: '2026-08-04T10:00:00.000Z',
            endsAt: '2026-08-04T12:00:00.000Z',
            occasions: [
              {
                id: '66666666-6666-4666-8666-666666666604',
                startsAt: '2026-08-04T10:00:00.000Z',
                endsAt: '2026-08-04T12:00:00.000Z',
                venueName: 'Arena',
                location: null,
              },
            ],
            meta: {
              possibleDuplicate: {
                eventId: hostId,
                title: 'Host',
                startsAt: '2026-08-02T16:00:00.000Z',
                refId: null,
                workerId: null,
                matchedOn: 'llm' as const,
              },
            },
          },
        ],
        [
          otherId,
          {
            ...base,
            id: otherId,
            title: 'Other',
            startsAt: '2026-08-05T10:00:00.000Z',
            endsAt: '2026-08-05T12:00:00.000Z',
            meta: {},
          },
        ],
      ]),
    };
    const { createMemoryAdminEventServices } =
      await import('../../../apps/admin-api/src/services/events');
    const app = createApp({
      auth,
      events: createMemoryAdminEventServices(eventStore),
    });
    const cookie = await loginSession(app);

    const denied = await app.request(`/v1/events/${hostId}/possible-duplicates`);
    expect(denied.status).toBe(401);

    const listed = await app.request(`/v1/events/${hostId}/possible-duplicates`, {
      headers: { cookie },
    });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      items: {
        id: string;
        location: string | null;
        workerId: string | null;
        occasions: { venueName: string | null }[];
      }[];
    };
    expect(body.items.map((item) => item.id)).toEqual([matchId, incomingId]);
    expect(body.items[0]).toMatchObject({
      location: 'Promenaden 5, 82433, Hudiksvall',
      workerId: 'visit-soderhamn',
    });
    expect(body.items[0]?.occasions.map((occasion) => occasion.venueName)).toEqual([
      'Park',
      'Square',
    ]);

    const wrong = await app.request(`/v1/events/${hostId}/merge-duplicates`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ eventIds: [otherId] }),
    });
    expect(wrong.status).toBe(400);

    const merged = await app.request(`/v1/events/${hostId}/merge-duplicates`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ eventIds: [matchId] }),
    });
    expect(merged.status).toBe(200);
    expect(await merged.json()).toMatchObject({
      id: hostId,
      warnings: [],
      occasions: [hostOccasion],
      meta: {
        freeEntry: true,
        mergedDuplicates: [{ eventId: matchId, title: 'Match' }],
      },
    });
    expect(eventStore.events.get(hostId)?.meta).not.toHaveProperty('possibleDuplicate');
    expect(eventStore.events.get(hostId)?.occasions).toEqual([hostOccasion]);
    expect(eventStore.events.get(matchId)?.status).toBe('deleted');
    expect(eventStore.events.get(matchId)?.occasions).toEqual(matchOccasions);
    expect(eventStore.events.get(matchId)?.meta).toEqual({
      freeEntry: true,
      address: { address: 'Promenaden 5', zipCode: '82433', city: 'Hudiksvall' },
      duplicateOf: { eventId: hostId, title: 'Host' },
    });
    expect(eventStore.events.get(incomingId)?.status).toBe('in_review');

    const remaining = await app.request(`/v1/events/${hostId}/possible-duplicates`, {
      headers: { cookie },
    });
    const left = (await remaining.json()) as { items: { id: string }[] };
    expect(left.items.map((item) => item.id)).toEqual([incomingId]);
  });

  it('cancels an imported review event and wipes any event that has no audience', async () => {
    const { auth } = await seededAuth();
    const inReviewId = '44444444-4444-4444-8444-444444444401';
    const wipeId = '44444444-4444-4444-8444-444444444404';
    const publishedId = '44444444-4444-4444-8444-444444444402';
    const nativeId = '44444444-4444-4444-8444-444444444403';
    const eventStore = {
      publishers: new Map([
        [
          '22222222-2222-4222-8222-222222222201',
          { id: '22222222-2222-4222-8222-222222222201', name: 'Imported Band' },
        ],
      ]),
      wipeBlocked: new Set<string>(),
      events: new Map([
        [
          inReviewId,
          {
            id: inReviewId,
            publisherId: '22222222-2222-4222-8222-222222222201',
            title: 'Concert',
            mode: 'physical' as const,
            status: 'in_review',
            origin: 'imported' as const,
            startsAt: '2026-07-01T18:00:00.000Z',
            endsAt: '2026-07-01T21:00:00.000Z',
            venueName: 'Arena',
            sourceUrl: 'https://example.com',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        [
          wipeId,
          {
            id: wipeId,
            publisherId: '22222222-2222-4222-8222-222222222201',
            title: 'Wipe me',
            mode: 'physical' as const,
            status: 'in_review',
            origin: 'imported' as const,
            startsAt: '2026-07-04T18:00:00.000Z',
            endsAt: '2026-07-04T21:00:00.000Z',
            venueName: 'Arena',
            sourceUrl: 'https://example.com/wipe',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        [
          publishedId,
          {
            id: publishedId,
            publisherId: '22222222-2222-4222-8222-222222222201',
            title: 'Already live',
            mode: 'physical' as const,
            status: 'published',
            origin: 'imported' as const,
            startsAt: '2026-07-02T18:00:00.000Z',
            endsAt: '2026-07-02T21:00:00.000Z',
            venueName: 'Arena',
            sourceUrl: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        [
          nativeId,
          {
            id: nativeId,
            publisherId: '22222222-2222-4222-8222-222222222201',
            title: 'Local draft',
            mode: 'physical' as const,
            status: 'in_review',
            origin: 'native' as const,
            startsAt: '2026-07-03T18:00:00.000Z',
            endsAt: '2026-07-03T21:00:00.000Z',
            venueName: null,
            sourceUrl: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      ]),
    };
    const { createMemoryAdminEventServices } =
      await import('../../../apps/admin-api/src/services/events');
    const app = createApp({
      auth,
      events: createMemoryAdminEventServices(eventStore),
    });
    const cookie = await loginSession(app);

    const removed = await app.request(`/v1/events/${inReviewId}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ id: inReviewId, status: 'deleted' });
    expect(eventStore.events.get(inReviewId)?.status).toBe('deleted');

    const wiped = await app.request(`/v1/events/${wipeId}/wipe`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(wiped.status).toBe(200);
    expect(await wiped.json()).toEqual({ id: wipeId });
    expect(eventStore.events.has(wipeId)).toBe(false);

    const wipeCancelled = await app.request(`/v1/events/${inReviewId}/wipe`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(wipeCancelled.status).toBe(200);
    expect(eventStore.events.has(inReviewId)).toBe(false);

    const refused = await app.request(`/v1/events/${publishedId}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(refused.status).toBe(404);
    expect(eventStore.events.has(publishedId)).toBe(true);

    const native = await app.request(`/v1/events/${nativeId}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(native.status).toBe(404);
    expect(eventStore.events.has(nativeId)).toBe(true);

    const wipePublished = await app.request(`/v1/events/${publishedId}/wipe`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(wipePublished.status).toBe(200);
    expect(eventStore.events.has(publishedId)).toBe(false);

    const wipeNative = await app.request(`/v1/events/${nativeId}/wipe`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(wipeNative.status).toBe(200);
    expect(eventStore.events.has(nativeId)).toBe(false);

    const blockedId = '44444444-4444-4444-8444-444444444405';
    eventStore.events.set(blockedId, {
      id: blockedId,
      publisherId: '22222222-2222-4222-8222-222222222201',
      title: 'Has a check-in',
      mode: 'physical',
      status: 'published',
      origin: 'native',
      startsAt: '2026-07-05T18:00:00.000Z',
      endsAt: '2026-07-05T21:00:00.000Z',
      venueName: null,
      sourceUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    eventStore.wipeBlocked.add(blockedId);
    const wipeBlocked = await app.request(`/v1/events/${blockedId}/wipe`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(wipeBlocked.status).toBe(404);
    expect(eventStore.events.has(blockedId)).toBe(true);

    const anonymous = await app.request(`/v1/events/${publishedId}`, { method: 'DELETE' });
    expect(anonymous.status).toBe(401);
    const anonymousWipe = await app.request(`/v1/events/${wipeId}/wipe`, { method: 'POST' });
    expect(anonymousWipe.status).toBe(401);
  });

  it('reads and edits an event, and rejects an incomplete digital event', async () => {
    const { auth } = await seededAuth();
    const tagId = '55555555-5555-4555-8555-555555555501';
    const eventStore = {
      publishers: new Map([
        [
          '22222222-2222-4222-8222-222222222201',
          { id: '22222222-2222-4222-8222-222222222201', name: 'Hall' },
        ],
      ]),
      tags: new Map([
        [
          tagId,
          {
            id: tagId,
            slug: 'idrott-tavlingar',
            name: 'Idrott & Tävlingar',
          },
        ],
      ]),
      events: new Map([
        [
          '44444444-4444-4444-8444-444444444401',
          {
            id: '44444444-4444-4444-8444-444444444401',
            publisherId: '22222222-2222-4222-8222-222222222201',
            title: 'Concert',
            description: 'Live',
            mode: 'physical' as const,
            status: 'published',
            origin: 'native' as const,
            startsAt: '2026-07-01T16:00:00.000Z',
            endsAt: '2026-07-01T19:00:00.000Z',
            timezone: 'Europe/Stockholm',
            venueName: 'Arena',
            location: { lat: 61.3, lng: 17.05 },
            sourceUrl: null,
            contentVerdict: 'spam',
            llmOutput: { contentVerdict: 'spam', possibleTags: [] },
            images: [
              { role: 'main', s3Key: 'events/44444444-4444-4444-8444-444444444401/main' },
              { role: 'gallery-1', s3Key: 'events/44444444-4444-4444-8444-444444444401/gallery-1' },
            ],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        [
          '66666666-6666-4666-8666-666666666601',
          {
            id: '66666666-6666-4666-8666-666666666601',
            publisherId: '22222222-2222-4222-8222-222222222201',
            title: 'Stream',
            description: null,
            mode: 'digital' as const,
            status: 'published',
            origin: 'native' as const,
            startsAt: '2026-07-02T16:00:00.000Z',
            endsAt: '2026-07-02T19:00:00.000Z',
            timezone: 'Europe/Stockholm',
            venueName: null,
            location: null,
            onlineUrl: null,
            sourceUrl: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      ]),
    };
    const domainEvents = createMemoryDomainEventPublisher();
    const { createMemoryAdminEventServices } =
      await import('../../../apps/admin-api/src/services/events');
    const app = createApp({
      auth,
      events: createMemoryAdminEventServices(eventStore, {
        domainEvents,
        assetsPublicBaseUrl: 'https://assets.example',
      }),
    });
    const cookie = await loginSession(app);

    const missing = await app.request('/v1/events/44444444-4444-4444-8444-444444444401');
    expect(missing.status).toBe(401);

    const detail = await app.request('/v1/events/44444444-4444-4444-8444-444444444401', {
      headers: { cookie },
    });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      title: 'Concert',
      description: 'Live',
      location: { lat: 61.3, lng: 17.05 },
      contentVerdict: 'spam',
      llmOutput: { contentVerdict: 'spam', possibleTags: [] },
      tagCount: 0,
      imageUrl: 'https://assets.example/events/44444444-4444-4444-8444-444444444401/main',
      imageUrls: ['https://assets.example/events/44444444-4444-4444-8444-444444444401/gallery-1'],
    });

    const tags = await app.request('/v1/tags', { headers: { cookie } });
    expect(tags.status).toBe(200);
    expect(await tags.json()).toMatchObject({ items: [{ slug: 'idrott-tavlingar' }] });

    const patched = await app.request('/v1/events/44444444-4444-4444-8444-444444444401', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Concert (updated)',
        venueName: 'New hall',
        tagIds: [tagId],
        links: [{ type: 'tickets', url: 'https://tickets.example/c', label: 'Tickets' }],
      }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      title: 'Concert (updated)',
      venueName: 'New hall',
      tagIds: [tagId],
      tagCount: 1,
      links: [{ type: 'tickets', url: 'https://tickets.example/c', label: 'Tickets' }],
    });
    expect(domainEvents.events).toEqual([
      {
        type: 'event.updated',
        eventId: '44444444-4444-4444-8444-444444444401',
        changedFields: ['title', 'venueName', 'tagIds', 'links'],
      },
    ]);

    const digital = await app.request('/v1/events/44444444-4444-4444-8444-444444444401', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'digital', onlineUrl: null }),
    });
    expect(digital.status).toBe(400);
    expect(await digital.json()).toMatchObject({ error: { code: 'online_url_required' } });
    expect(eventStore.events.get('44444444-4444-4444-8444-444444444401')?.mode).toBe('physical');

    const featured = await app.request('/v1/events/66666666-6666-4666-8666-666666666601', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ featured: true, checkInEnabled: true }),
    });
    expect(featured.status).toBe(200);
    expect(await featured.json()).toMatchObject({
      featured: true,
      checkInEnabled: true,
      mode: 'digital',
      onlineUrl: null,
    });
    expect(domainEvents.events.at(-1)).toEqual({
      type: 'event.updated',
      eventId: '66666666-6666-4666-8666-666666666601',
      changedFields: ['featured', 'checkInEnabled'],
    });

    const sponsored = await app.request('/v1/events/66666666-6666-4666-8666-666666666601', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ sponsored: true }),
    });
    expect(sponsored.status).toBe(200);
    expect(await sponsored.json()).toMatchObject({ sponsored: true, posterUrl: null });

    const poster = await app.request('/v1/events/66666666-6666-4666-8666-666666666601/poster', {
      method: 'POST',
      headers: { cookie, 'content-type': 'image/png' },
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    expect(poster.status).toBe(200);
    const uploaded = (await poster.json()) as { posterUrl: string };
    expect(uploaded.posterUrl).toMatch(
      /^https:\/\/assets\.example\/events\/66666666-6666-4666-8666-666666666601\/poster\/[0-9a-f-]{36}$/,
    );
    expect(domainEvents.events.at(-1)).toEqual({
      type: 'event.updated',
      eventId: '66666666-6666-4666-8666-666666666601',
      changedFields: ['poster'],
    });

    const replaced = await app.request('/v1/events/66666666-6666-4666-8666-666666666601/poster', {
      method: 'POST',
      headers: { cookie, 'content-type': 'image/png' },
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    expect(replaced.status).toBe(200);
    const nextPoster = (await replaced.json()) as { posterUrl: string };
    expect(nextPoster.posterUrl).not.toBe(uploaded.posterUrl);

    const removed = await app.request('/v1/events/66666666-6666-4666-8666-666666666601/poster', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ posterUrl: null });
    const afterRemove = await app.request('/v1/events/66666666-6666-4666-8666-666666666601', {
      headers: { cookie },
    });
    expect(await afterRemove.json()).toMatchObject({ sponsored: true, posterUrl: null });

    const gif = await app.request('/v1/events/66666666-6666-4666-8666-666666666601/poster', {
      method: 'POST',
      headers: { cookie, 'content-type': 'image/gif' },
      body: new Uint8Array([71, 73, 70]),
    });
    expect(gif.status).toBe(400);
    expect(await gif.json()).toMatchObject({ error: { code: 'unsupported_type' } });

    const backwards = await app.request('/v1/events/44444444-4444-4444-8444-444444444401', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ endsAt: '2026-07-01T15:00:00.000Z' }),
    });
    expect(backwards.status).toBe(400);
    expect(await backwards.json()).toMatchObject({ error: { code: 'invalid_event' } });

    const cancelled = await app.request('/v1/events/44444444-4444-4444-8444-444444444401', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      status: 'cancelled',
      title: 'Concert (updated)',
    });

    const unknown = await app.request('/v1/events/44444444-4444-4444-8444-444444444499', {
      headers: { cookie },
    });
    expect(unknown.status).toBe(404);
  });

  it('lists audit log and bans a user', async () => {
    const { auth } = await seededAuth();
    const { createMemoryAdminAuditServices } =
      await import('../../../apps/admin-api/src/services/audit');
    const { createMemoryAdminModerationServices } =
      await import('../../../apps/admin-api/src/services/moderation');
    const audit = createMemoryAdminAuditServices({ entries: [] });
    const moderation = createMemoryAdminModerationServices(
      {
        users: new Map([
          [
            'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            {
              id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              displayName: 'Pat',
              recoveryEmail: null,
              isPublic: false,
              bannedAt: null,
              banReason: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              lastSeenAt: null,
            },
          ],
        ]),
        ratings: new Map(),
        checkIns: new Map(),
      },
      { audit },
    );
    const app = createApp({ auth, audit, moderation });
    const cookie = await loginSession(app);

    const empty = await app.request('/v1/audit-log', { headers: { cookie } });
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { items: unknown[] }).items).toHaveLength(0);

    const ban = await app.request('/v1/users/cccccccc-cccc-4ccc-8ccc-cccccccccccc/ban', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'spam' }),
    });
    expect(ban.status).toBe(200);
    expect(await ban.json()).toMatchObject({ bannedAt: expect.any(String), banReason: 'spam' });

    const log = await app.request('/v1/audit-log', { headers: { cookie } });
    expect(log.status).toBe(200);
    const items = ((await log.json()) as { items: { action: string }[] }).items;
    expect(items.some((i) => i.action === 'user.ban')).toBe(true);
  });

  it('creates an approved broadcast for everyone', async () => {
    const { auth } = await seededAuth();
    const app = createApp({ auth });
    const cookie = await loginSession(app);

    const create = await app.request('/v1/push-messages/broadcast', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        titleSv: 'Hej',
        bodySv: 'Ett meddelande',
        titleEn: 'Hi',
        bodyEn: 'A message',
        audience: 'everyone',
        sendAt: null,
      }),
    });
    expect(create.status).toBe(201);
    const row = (await create.json()) as {
      kind: string;
      audience: string;
      status: string;
      eventId: string | null;
    };
    expect(row).toMatchObject({
      kind: 'broadcast',
      audience: 'everyone',
      status: 'approved',
      eventId: null,
    });

    const list = await app.request('/v1/push-messages', { headers: { cookie } });
    expect(list.status).toBe(200);
    const items = ((await list.json()) as { items: { kind: string }[] }).items;
    expect(items.some((i) => i.kind === 'broadcast')).toBe(true);
  });

  it('rejects tag_interest broadcast without audienceTagId', async () => {
    const { auth } = await seededAuth();
    const app = createApp({ auth });
    const cookie = await loginSession(app);

    const create = await app.request('/v1/push-messages/broadcast', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        titleSv: 'Hej',
        bodySv: 'Ett meddelande',
        titleEn: 'Hi',
        bodyEn: 'A message',
        audience: 'tag_interest',
      }),
    });
    expect(create.status).toBe(400);
  });

  it('creates an approved notification for a published event', async () => {
    const { auth } = await seededAuth();
    const eventId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const events = new Map<string, AdminPushEventRef>([
      [
        eventId,
        {
          id: eventId,
          title: 'Jazzkväll',
          status: 'published',
          publisherId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          publisherName: 'Folkets hus',
        },
      ],
    ]);
    const pushMessages = createMemoryAdminPushMessageServices({ events });
    const app = createApp({ auth, pushMessages });
    const cookie = await loginSession(app);

    const create = await app.request('/v1/push-messages/event', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId,
        audience: 'area_and_tag',
        sendAt: '2026-06-20T18:00:00.000Z',
      }),
    });
    expect(create.status).toBe(201);
    const row = (await create.json()) as PushMessage;
    expect(row).toMatchObject({
      kind: 'event',
      audience: 'area_and_tag',
      status: 'approved',
      eventId,
      eventTitle: 'Jazzkväll',
      publisherName: 'Folkets hus',
      titleSv: 'Jazzkväll',
      copyEdited: false,
      approvedByAdminId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sendAt: '2026-06-20T18:00:00.000Z',
    });
    expect(row.bodyEn).toContain('near');

    const again = await app.request('/v1/push-messages/event', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId,
        audience: 'area',
        sendAt: '2026-06-19T18:00:00.000Z',
        titleSv: 'Påminnelse',
        bodySv: 'Imorgon',
        titleEn: 'Reminder',
        bodyEn: 'Tomorrow',
      }),
    });
    expect(again.status).toBe(201);
    const second = (await again.json()) as PushMessage;
    expect(second.id).not.toBe(row.id);
    expect(second.sendAt).toBe('2026-06-19T18:00:00.000Z');
  });

  it('creates every notification in an approved marketing plan', async () => {
    const { auth } = await seededAuth();
    const eventId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const draftId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const events = new Map<string, AdminPushEventRef>([
      [
        eventId,
        {
          id: eventId,
          title: 'Jazzkväll',
          status: 'published',
          publisherId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          publisherName: 'Folkets hus',
        },
      ],
      [
        draftId,
        {
          id: draftId,
          title: 'Utkast',
          status: 'draft',
          publisherId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          publisherName: 'Folkets hus',
        },
      ],
    ]);
    const pushMessages = createMemoryAdminPushMessageServices({ events });
    const app = createApp({ auth, pushMessages });
    const cookie = await loginSession(app);

    const create = await app.request('/v1/push-messages/event-plan', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId,
        audience: 'area_and_tag',
        notifications: [
          {
            titleSv: 'Jazzkväll',
            bodySv: 'Börjar om en vecka',
            titleEn: 'Jazzkväll',
            bodyEn: 'Starts in a week',
            sendAt: '2026-06-13T18:00:00.000Z',
          },
          {
            titleSv: 'Jazzkväll',
            bodySv: 'Börjar imorgon',
            titleEn: 'Jazzkväll',
            bodyEn: 'Starts tomorrow',
            sendAt: '2026-06-19T18:00:00.000Z',
          },
        ],
      }),
    });
    expect(create.status).toBe(201);
    const body = (await create.json()) as { items: PushMessage[] };
    expect(body.items).toHaveLength(2);
    expect(body.items.map((item) => item.sendAt).sort()).toEqual([
      '2026-06-13T18:00:00.000Z',
      '2026-06-19T18:00:00.000Z',
    ]);
    expect(body.items.every((item) => item.status === 'approved' && item.copyEdited)).toBe(true);

    const unpublished = await app.request('/v1/push-messages/event-plan', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId: draftId,
        audience: 'area',
        notifications: [
          {
            titleSv: 'A',
            bodySv: 'B',
            titleEn: 'A',
            bodyEn: 'B',
            sendAt: '2026-06-13T18:00:00.000Z',
          },
        ],
      }),
    });
    expect(unpublished.status).toBe(201);
    const held = (await unpublished.json()) as { items: PushMessage[] };
    expect(held.items).toHaveLength(1);
    expect(held.items[0]).toMatchObject({ status: 'pending', approvedAt: null });
  });

  it('keeps draft event notifications pending and rejects cancelled events', async () => {
    const { auth } = await seededAuth();
    const draftId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const events = new Map<string, AdminPushEventRef>([
      [
        draftId,
        {
          id: draftId,
          title: 'Utkast',
          status: 'draft',
          publisherId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          publisherName: 'Folkets hus',
        },
      ],
    ]);
    const app = createApp({
      auth,
      pushMessages: createMemoryAdminPushMessageServices({ events }),
    });
    const cookie = await loginSession(app);

    const missing = await app.request('/v1/push-messages/event', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId: '11111111-1111-4111-8111-111111111111',
        audience: 'area',
      }),
    });
    expect(missing.status).toBe(404);

    const unpublished = await app.request('/v1/push-messages/event', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ eventId: draftId, audience: 'area' }),
    });
    expect(unpublished.status).toBe(201);
    expect(await unpublished.json()).toMatchObject({ status: 'pending', approvedAt: null });

    events.set('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Inställt',
      status: 'cancelled',
      publisherId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      publisherName: 'Folkets hus',
    });
    const cancelled = await app.request('/v1/push-messages/event', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        audience: 'area',
      }),
    });
    expect(cancelled.status).toBe(400);
    expect(await cancelled.json()).toMatchObject({ error: { code: 'event_not_published' } });
  });

  it('allows another event notification after the previous one was sent', async () => {
    const { auth } = await seededAuth();
    const eventId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const events = new Map<string, AdminPushEventRef>([
      [
        eventId,
        {
          id: eventId,
          title: 'Jazzkväll',
          status: 'published',
          publisherId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          publisherName: 'Folkets hus',
        },
      ],
    ]);
    const sent: PushMessage = {
      id: '22222222-2222-4222-8222-222222222222',
      eventId,
      eventTitle: 'Jazzkväll',
      publisherId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      publisherName: 'Folkets hus',
      eventStatus: 'published',
      kind: 'event',
      audience: 'area',
      audienceTagId: null,
      status: 'sent',
      titleSv: 'Jazzkväll',
      bodySv: 'Ett nytt evenemang nära dig',
      titleEn: 'Jazzkväll',
      bodyEn: 'A new event near you',
      sendAt: null,
      copyEdited: false,
      approvedAt: '2026-06-01T00:00:00.000Z',
      approvedByAdminId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sentAt: '2026-06-01T00:00:00.000Z',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    const app = createApp({
      auth,
      pushMessages: createMemoryAdminPushMessageServices({
        events,
        items: new Map([[sent.id, sent]]),
      }),
    });
    const cookie = await loginSession(app);
    const create = await app.request('/v1/push-messages/event', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId,
        audience: 'area',
        titleSv: 'Påminnelse',
        bodySv: 'Ikväll',
        titleEn: 'Reminder',
        bodyEn: 'Tonight',
      }),
    });
    expect(create.status).toBe(201);
    expect(await create.json()).toMatchObject({
      titleSv: 'Påminnelse',
      audience: 'area',
      copyEdited: true,
      status: 'approved',
    });
  });

  it('lists sent notifications for an event and hides open drafts', async () => {
    const { auth } = await seededAuth();
    const eventId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const otherEventId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const sentId = '11111111-1111-4111-8111-111111111111';
    const sendingId = '22222222-2222-4222-8222-222222222222';
    const draftId = '33333333-3333-4333-8333-333333333333';
    const otherSentId = '44444444-4444-4444-8444-444444444444';
    const now = '2026-06-01T12:00:00.000Z';
    function row(
      id: string,
      status: PushMessage['status'],
      event: string,
      sentAt: string | null,
    ): PushMessage {
      return {
        id,
        eventId: event,
        eventTitle: 'Jazzkväll',
        publisherId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        publisherName: 'Folkets hus',
        eventStatus: 'published',
        kind: 'event',
        audience: 'area',
        audienceTagId: null,
        status,
        titleSv: 'Titel',
        bodySv: 'Brödtext',
        titleEn: 'Title',
        bodyEn: 'Body',
        sendAt: sentAt,
        copyEdited: false,
        approvedAt: now,
        approvedByAdminId: null,
        sentAt,
        createdAt: now,
        updatedAt: now,
      };
    }
    const pushMessages = createMemoryAdminPushMessageServices({
      items: new Map([
        [
          sentId,
          { ...row(sentId, 'sent', eventId, '2026-06-02T12:00:00.000Z'), titleSv: 'Skickad' },
        ],
        [sendingId, row(sendingId, 'sending', eventId, null)],
        [draftId, row(draftId, 'approved', eventId, null)],
        [otherSentId, row(otherSentId, 'sent', otherEventId, '2026-06-03T12:00:00.000Z')],
      ]),
      recipientCounts: new Map([[sentId, 4]]),
    });
    const app = createApp({ auth, pushMessages });

    const denied = await app.request(`/v1/events/${eventId}/sent-notifications`);
    expect(denied.status).toBe(401);

    const cookie = await loginSession(app);
    const list = await app.request(`/v1/events/${eventId}/sent-notifications`, {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      items: {
        id: string;
        status: string;
        recipientCount: number;
        sentAt: string | null;
        titleSv: string;
      }[];
    };
    expect(body.items.map((item) => item.id)).toEqual([sendingId, sentId]);
    expect(body.items[0]).toMatchObject({ status: 'sending', recipientCount: 0, sentAt: null });
    expect(body.items[1]).toMatchObject({
      status: 'sent',
      recipientCount: 4,
      titleSv: 'Skickad',
    });
  });

  it('enrolls TOTP on first login when secret is unset', async () => {
    const store = createAdminMemoryAuthStore();
    store.admins.set('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      email: 'new@example.com',
      passwordHash: await hashPassword('admin-password-long'),
      totpSecret: null,
      role: 'admin',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const now = () => new Date('2026-06-15T12:00:00.000Z');
    const auth = createMemoryAdminAuthServices(store, { now });
    const app = createApp({ auth });

    const login = await app.request('/v1/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', password: 'admin-password-long' }),
    });
    expect(login.status).toBe(200);
    const setup = (await login.json()) as {
      status: string;
      setupToken: string;
      secret: string;
    };
    expect(setup.status).toBe('totp_setup');
    const code = generateTotpCode(setup.secret, now().getTime());
    const confirm = await app.request('/v1/admin/login/totp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: setup.setupToken, code }),
    });
    expect(confirm.status).toBe(200);
    expect(store.admins.get('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')?.totpSecret).toBe(setup.secret);
  });

  it('logs time, method, path with query, request id, and ip', async () => {
    const lines: string[] = [];
    const app = createApp({ accessLog: (line) => lines.push(line) });
    const res = await app.request('/health?probe=1', {
      headers: {
        'x-forwarded-for': '[2001:db8::1], 10.0.0.1',
        'x-request-id': 'admin-req-1',
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('admin-req-1');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z - GET - \/health\?probe=1 - admin-req-1 - 2001:db8::1$/,
    );
  });

  it('pages and searches the event catalog', async () => {
    const { auth } = await seededAuth();
    const publisherA = '22222222-2222-4222-8222-222222222201';
    const publisherB = '22222222-2222-4222-8222-222222222202';
    const eventStore = {
      publishers: new Map([
        [publisherA, { id: publisherA, name: 'Jazz Club' }],
        [publisherB, { id: publisherB, name: 'Other Hall' }],
      ]),
      events: new Map(
        [
          ['Jazz Night', '2026-08-03T18:00:00.000Z', 'Storan', publisherA, 'published'],
          ['Market', '2026-08-02T18:00:00.000Z', 'Square', publisherA, 'published'],
          ['Choir', '2026-08-01T18:00:00.000Z', 'Jazzkällaren', publisherB, 'cancelled'],
          ['100% fun', '2026-08-04T18:00:00.000Z', 'Park', publisherB, 'published'],
          ['Gone', '2026-08-05T18:00:00.000Z', 'Hall', publisherA, 'deleted'],
        ].map(([title, startsAt, venueName, publisherId, status], index) => {
          const id = `44444444-4444-4444-8444-44444444440${index + 1}`;
          return [
            id,
            {
              id,
              publisherId,
              title,
              mode: 'physical' as const,
              status,
              origin: 'imported' as const,
              startsAt,
              endsAt: '2026-08-04T21:00:00.000Z',
              venueName,
              sourceUrl: null,
              tagIds:
                title === 'Jazz Night'
                  ? ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2']
                  : [],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ] as const;
        }),
      ),
    };
    const { createMemoryAdminEventServices } =
      await import('../../../apps/admin-api/src/services/events');
    const app = createApp({
      auth,
      events: createMemoryAdminEventServices(eventStore),
    });
    const cookie = await loginSession(app);

    const denied = await app.request('/v1/events?limit=2');
    expect(denied.status).toBe(401);

    const page = await app.request('/v1/events?limit=2&offset=0', { headers: { cookie } });
    expect(page.status).toBe(200);
    const first = (await page.json()) as {
      items: { title: string; tagCount: number }[];
      total: number;
      nextOffset: number | null;
    };
    expect(first.total).toBe(4);
    expect(first.nextOffset).toBe(2);
    expect(first.items.map((item) => item.title)).toEqual(['100% fun', 'Jazz Night']);
    expect(first.items.map((item) => item.tagCount)).toEqual([0, 2]);

    const last = await app.request('/v1/events?limit=2&offset=2', { headers: { cookie } });
    const second = (await last.json()) as { items: { title: string }[]; nextOffset: number | null };
    expect(second.items.map((item) => item.title)).toEqual(['Market', 'Choir']);
    expect(second.nextOffset).toBeNull();

    const search = await app.request('/v1/events?q=jazz&limit=50', { headers: { cookie } });
    const found = (await search.json()) as { items: { title: string }[]; total: number };
    expect(found.total).toBe(3);
    expect(found.items.map((item) => item.title).sort()).toEqual(['Choir', 'Jazz Night', 'Market']);

    const literal = await app.request(`/v1/events?q=${encodeURIComponent('%')}&limit=50`, {
      headers: { cookie },
    });
    const percent = (await literal.json()) as { items: { title: string }[] };
    expect(percent.items.map((item) => item.title)).toEqual(['100% fun']);

    const filtered = await app.request('/v1/events?status=cancelled&limit=50', {
      headers: { cookie },
    });
    const cancelled = (await filtered.json()) as { items: { title: string }[]; total: number };
    expect(cancelled.total).toBe(1);
    expect(cancelled.items[0]?.title).toBe('Choir');

    const untagged = await app.request('/v1/events?untagged=true&limit=50', {
      headers: { cookie },
    });
    const noTags = (await untagged.json()) as {
      items: { title: string; tagCount: number }[];
      total: number;
    };
    expect(noTags.total).toBe(3);
    expect(noTags.items.map((item) => item.title)).toEqual(['100% fun', 'Market', 'Choir']);
    expect(noTags.items.every((item) => item.tagCount === 0)).toBe(true);

    const untaggedCancelled = await app.request(
      '/v1/events?untagged=true&status=cancelled&limit=50',
      { headers: { cookie } },
    );
    const cancelledUntagged = (await untaggedCancelled.json()) as {
      items: { title: string }[];
      total: number;
    };
    expect(cancelledUntagged.total).toBe(1);
    expect(cancelledUntagged.items[0]?.title).toBe('Choir');

    const rejected = await app.request('/v1/events?untagged=false&limit=50', {
      headers: { cookie },
    });
    expect(rejected.status).toBe(400);
  });

  it('pages the review queue oldest created first', async () => {
    const { auth } = await seededAuth();
    const publisherId = '22222222-2222-4222-8222-222222222201';
    const rows = [
      ['Newest', '2026-03-01T00:00:00.000Z', 'Hall'],
      ['Oldest', '2026-01-01T00:00:00.000Z', 'Park'],
      ['Middle', '2026-02-01T00:00:00.000Z', 'Square'],
    ] as const;
    const eventStore = {
      publishers: new Map([[publisherId, { id: publisherId, name: 'Imported Band' }]]),
      events: new Map(
        rows.map(([title, createdAt, venueName], index) => {
          const id = `44444444-4444-4444-8444-44444444440${index + 1}`;
          return [
            id,
            {
              id,
              publisherId,
              title,
              mode: 'physical' as const,
              status: 'in_review' as const,
              origin: 'imported' as const,
              startsAt: '2026-08-01T18:00:00.000Z',
              endsAt: '2026-08-01T21:00:00.000Z',
              venueName,
              workerId:
                title === 'Oldest' ? 'visit-soderhamn' : title === 'Middle' ? 'glada-hudik' : null,
              sourceUrl: 'https://example.com/show',
              contentVerdict: 'harmful',
              tagIds: title === 'Oldest' ? ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'] : [],
              createdAt,
              updatedAt: createdAt,
            },
          ] as const;
        }),
      ),
    };
    const { createMemoryAdminEventServices } =
      await import('../../../apps/admin-api/src/services/events');
    const app = createApp({
      auth,
      events: createMemoryAdminEventServices(eventStore),
    });
    const cookie = await loginSession(app);

    const tooBig = await app.request('/v1/events?status=in_review&sort=created&limit=101', {
      headers: { cookie },
    });
    expect(tooBig.status).toBe(400);

    const page = await app.request('/v1/events?status=in_review&sort=created&limit=2&offset=0', {
      headers: { cookie },
    });
    expect(page.status).toBe(200);
    const first = (await page.json()) as {
      items: {
        title: string;
        sourceUrl: string | null;
        contentVerdict: string;
        tagCount: number;
      }[];
      total: number;
      nextOffset: number | null;
    };
    expect(first.total).toBe(3);
    expect(first.nextOffset).toBe(2);
    expect(first.items.map((item) => item.title)).toEqual(['Oldest', 'Middle']);
    expect(first.items.map((item) => item.tagCount)).toEqual([1, 0]);
    expect(first.items[0]?.sourceUrl).toBe('https://example.com/show');
    expect(first.items[0]?.contentVerdict).toBe('harmful');

    const last = await app.request('/v1/events?status=in_review&sort=created&limit=2&offset=2', {
      headers: { cookie },
    });
    const second = (await last.json()) as { items: { title: string }[]; nextOffset: number | null };
    expect(second.items.map((item) => item.title)).toEqual(['Newest']);
    expect(second.nextOffset).toBeNull();

    const search = await app.request('/v1/events?status=in_review&sort=created&q=park&limit=100', {
      headers: { cookie },
    });
    const found = (await search.json()) as { items: { title: string }[]; total: number };
    expect(found.total).toBe(1);
    expect(found.items[0]?.title).toBe('Oldest');

    const untagged = await app.request(
      '/v1/events?status=in_review&sort=created&untagged=true&limit=100',
      { headers: { cookie } },
    );
    const noTags = (await untagged.json()) as {
      items: { title: string; tagCount: number }[];
      total: number;
    };
    expect(noTags.total).toBe(2);
    expect(noTags.items.map((item) => item.title)).toEqual(['Middle', 'Newest']);
    expect(noTags.items.every((item) => item.tagCount === 0)).toBe(true);

    const byWorker = await app.request(
      '/v1/events?status=in_review&sort=created&worker=visit-soderhamn&limit=100',
      { headers: { cookie } },
    );
    const visit = (await byWorker.json()) as {
      items: { title: string; workerId: string }[];
      total: number;
    };
    expect(byWorker.status).toBe(200);
    expect(visit.total).toBe(1);
    expect(visit.items[0]?.title).toBe('Oldest');
    expect(visit.items[0]?.workerId).toBe('visit-soderhamn');

    const missing = await app.request(
      '/v1/events?status=in_review&worker=missing-worker&limit=100',
      { headers: { cookie } },
    );
    const empty = (await missing.json()) as { total: number };
    expect(missing.status).toBe(200);
    expect(empty.total).toBe(0);

    const tooLong = await app.request(`/v1/events?worker=${'a'.repeat(81)}&limit=50`, {
      headers: { cookie },
    });
    expect(tooLong.status).toBe(400);

    const denied = await app.request('/v1/events/workers');
    expect(denied.status).toBe(401);

    const workers = await app.request('/v1/events/workers', { headers: { cookie } });
    const listed = (await workers.json()) as { items: string[] };
    expect(workers.status).toBe(200);
    expect(listed.items).toEqual(['glada-hudik', 'visit-soderhamn']);
  });

  it('marks a possible duplicate on the review list', async () => {
    const { auth } = await seededAuth();
    const publisherId = '22222222-2222-4222-8222-222222222201';
    const flaggedId = '44444444-4444-4444-8444-444444444401';
    const cleanId = '44444444-4444-4444-8444-444444444402';
    const matchedId = '55555555-5555-4555-8555-555555555501';
    const eventStore = {
      publishers: new Map([[publisherId, { id: publisherId, name: 'Imported Band' }]]),
      events: new Map([
        [
          flaggedId,
          {
            id: flaggedId,
            publisherId,
            title: 'Concert',
            mode: 'physical' as const,
            status: 'in_review' as const,
            origin: 'imported' as const,
            startsAt: '2026-08-01T18:00:00.000Z',
            endsAt: '2026-08-01T21:00:00.000Z',
            venueName: 'Arena',
            sourceUrl: 'https://example.com/show',
            meta: {
              possibleDuplicate: {
                eventId: matchedId,
                title: 'Existing concert',
                startsAt: '2026-08-01T18:00:00.000Z',
                refId: 'cbis:1',
                workerId: 'visit-soderhamn',
                matchedOn: 'title' as const,
              },
            },
            createdAt: '2026-01-02T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        [
          cleanId,
          {
            id: cleanId,
            publisherId,
            title: 'Market',
            mode: 'physical' as const,
            status: 'in_review' as const,
            origin: 'imported' as const,
            startsAt: '2026-08-02T18:00:00.000Z',
            endsAt: '2026-08-02T21:00:00.000Z',
            venueName: 'Square',
            sourceUrl: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      ]),
    };
    const { createMemoryAdminEventServices } =
      await import('../../../apps/admin-api/src/services/events');
    const app = createApp({
      auth,
      events: createMemoryAdminEventServices(eventStore),
    });
    const cookie = await loginSession(app);

    const page = await app.request('/v1/events?status=in_review&sort=created&limit=100', {
      headers: { cookie },
    });
    expect(page.status).toBe(200);
    const body = (await page.json()) as {
      items: { id: string; warnings: { code: string; title: string; eventId: string }[] }[];
    };
    expect(body.items.find((item) => item.id === cleanId)?.warnings).toEqual([]);
    expect(body.items.find((item) => item.id === flaggedId)?.warnings).toEqual([
      {
        code: 'possible_duplicate',
        eventId: matchedId,
        title: 'Existing concert',
        matchedOn: 'title',
      },
    ]);
  });

  it('signs in with a one-time email code and rejects reuse, expiry, and unknown emails', async () => {
    let at = new Date('2026-06-15T12:00:00.000Z');
    const { store } = await seededAuth();
    const quiet = createApp({
      auth: createMemoryAdminAuthServices(store, { now: () => at }),
    });
    const hidden = await quiet.request('/v1/admin/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com' }),
    });
    expect(hidden.status).toBe(200);
    expect(await hidden.json()).toEqual({ status: 'code_sent' });

    const auth = createMemoryAdminAuthServices(store, {
      now: () => at,
      includeLoginOtp: true,
    });
    const app = createApp({ auth });

    const unknown = await app.request('/v1/admin/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'missing@example.com' }),
    });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ status: 'code_sent' });

    const issued = await app.request('/v1/admin/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com' }),
    });
    expect(issued.status).toBe(200);
    const first = (await issued.json()) as { status: string; code?: string };
    expect(first.status).toBe('code_sent');
    expect(first.code).toMatch(/^\d{6}$/);

    const replaced = await app.request('/v1/admin/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com' }),
    });
    const second = (await replaced.json()) as { code: string };
    expect(second.code).not.toBe(first.code);

    const stale = await app.request('/v1/admin/login/otp/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', code: first.code }),
    });
    expect(stale.status).toBe(401);
    expect(await stale.json()).toMatchObject({ error: { code: 'invalid_otp' } });

    const wrong = await app.request('/v1/admin/login/otp/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        code: second.code === '000000' ? '000001' : '000000',
      }),
    });
    expect(wrong.status).toBe(401);

    const ok = await app.request('/v1/admin/login/otp/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', code: second.code }),
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie') ?? '').toContain('le_admin_session=');

    const reuse = await app.request('/v1/admin/login/otp/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', code: second.code }),
    });
    expect(reuse.status).toBe(401);

    const again = await app.request('/v1/admin/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com' }),
    });
    const expiring = (await again.json()) as { code: string };
    at = new Date(at.getTime() + 11 * 60 * 1000);
    const expired = await app.request('/v1/admin/login/otp/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', code: expiring.code }),
    });
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ error: { code: 'otp_expired' } });
  });

  it('burns an email code after five wrong guesses and limits requests', async () => {
    const { store } = await seededAuth();
    const app = createApp({
      auth: createMemoryAdminAuthServices(store, {
        now: () => new Date('2026-06-15T12:00:00.000Z'),
        includeLoginOtp: true,
      }),
    });

    const issued = await app.request('/v1/admin/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com' }),
    });
    const { code } = (await issued.json()) as { code: string };
    for (let i = 0; i < 5; i += 1) {
      const miss = await app.request('/v1/admin/login/otp/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@example.com',
          code: code === '111111' ? '222222' : '111111',
        }),
      });
      expect(miss.status).toBe(401);
    }
    const burned = await app.request('/v1/admin/login/otp/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', code }),
    });
    expect(burned.status).toBe(401);

    for (let i = 0; i < 4; i += 1) {
      const sent = await app.request('/v1/admin/login/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com' }),
      });
      expect(sent.status).toBe(200);
    }
    const limited = await app.request('/v1/admin/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com' }),
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: 'otp_rate_limited' } });
  });
});
