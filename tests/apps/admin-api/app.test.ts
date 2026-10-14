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
    expect(doc.paths['/publishers']).toBeDefined();
    expect(doc.paths['/publishers/{id}/verify']).toBeDefined();
    expect(doc.paths['/publishers/{id}/map']).toBeDefined();
    expect(doc.paths['/publishers/{id}/complete']).toBeDefined();
    expect(doc.paths['/events']).toBeDefined();
    expect(doc.paths['/events/{id}']).toBeDefined();
    expect(doc.paths['/tags']).toBeDefined();
    expect(doc.paths['/events/{id}/sent-notifications']).toBeDefined();
    expect(doc.paths['/events/{id}/approve']).toBeDefined();
    expect(doc.paths['/events/{id}/reject']).toBeDefined();
    expect(doc.paths['/data-sources']).toBeDefined();
    expect(doc.paths['/data-sources/{id}/runs']).toBeDefined();
    expect(doc.paths['/data-sources/{id}/run']).toBeDefined();
  });

  it('rejects publisher list without session', async () => {
    const { auth } = await seededAuth();
    const app = createApp({ auth });
    const list = await app.request('/v1/publishers?verified=false');
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
          verified: false,
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

    const list = await app.request('/v1/publishers?verified=false', {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(1);

    const verify = await app.request('/v1/publishers/22222222-2222-4222-8222-222222222201/verify', {
      method: 'POST',
      headers: { cookie },
    });
    expect(verify.status).toBe(200);
    expect(await verify.json()).toMatchObject({
      verified: true,
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
          verified: true,
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
});
