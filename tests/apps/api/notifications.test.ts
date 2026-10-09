import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { createMemoryNotificationServices } from '../../../apps/api/src/services/notifications/memory';
import { createMemoryPreferenceServices } from '../../../apps/api/src/services/preferences/memory';
import { createMemoryStore } from '../../../apps/api/src/services/memory-store';

async function createUserSession(app: ReturnType<typeof createApp>) {
  const created = await app.request('/v1/identities', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'ios', locale: 'sv' }),
  });
  expect(created.status).toBe(201);
  return (await created.json()) as { sessionToken: string; userId: string };
}

describe('notification inbox', () => {
  it('documents OpenAPI paths', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/me/notifications']).toBeDefined();
    expect(doc.paths['/me/quiet-hours']).toBeDefined();
  });

  it('lists inbox items and updates quiet hours', async () => {
    const store = createMemoryStore();
    const env = { includeVerificationToken: true, now: () => new Date() };
    const auth = createMemoryAuthServices(env, store);
    const preferences = createMemoryPreferenceServices(auth, { now: env.now }, store);
    const notifications = createMemoryNotificationServices(auth, store);
    const app = createApp({ auth, preferences, notifications });

    const session = await createUserSession(app);
    const authHeader = { authorization: `Bearer ${session.sessionToken}` };

    const empty = await app.request('/v1/me/notifications', { headers: authHeader });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ items: [], unreadCount: 0 });

    const eventId = '11111111-1111-4111-8111-111111111301';
    store.events.set(eventId, {
      id: eventId,
      publisherId: '11111111-1111-4111-8111-111111111302',
      title: 'Quiet show',
      description: null,
      mode: 'physical',
      status: 'published',
      origin: 'native',
      startsAt: new Date().toISOString(),
      endsAt: new Date().toISOString(),
      timezone: 'Europe/Stockholm',
      venueName: null,
      location: null,
      geofenceRadiusM: null,
      onlineUrl: null,
      categoryIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startsAtDate: new Date(),
      endsAtDate: new Date(),
    });
    store.notifications.set('notif-1', {
      id: 'notif-1',
      userId: session.userId,
      eventId,
      reason: 'nearby',
      pushState: 'pending',
      sentAt: new Date('2026-06-15T21:00:00.000Z'),
      pushedAt: null,
      readAt: null,
    });

    const listed = await app.request('/v1/me/notifications', { headers: authHeader });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      items: Array<{ eventTitle: string; pushState: string }>;
      unreadCount: number;
    };
    expect(body.items).toHaveLength(1);
    expect(body.unreadCount).toBe(1);
    expect(body.items[0]).toMatchObject({
      eventTitle: 'Quiet show',
      pushState: 'pending',
    });

    const quiet = await app.request('/v1/me/quiet-hours', {
      method: 'PUT',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false, startMin: 23 * 60, endMin: 7 * 60 }),
    });
    expect(quiet.status).toBe(200);
    expect(await quiet.json()).toEqual({
      enabled: false,
      startMin: 23 * 60,
      endMin: 7 * 60,
      timezone: 'Europe/Stockholm',
    });
  });
});
