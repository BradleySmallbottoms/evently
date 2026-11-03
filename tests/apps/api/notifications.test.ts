import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { notificationMessageFields } from '../../../apps/api/src/services/notifications/copy';
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
  it('copies the push headline and keeps tip status on tip notices', () => {
    const message = {
      titleSv: 'Ditt tips har publicerats',
      titleEn: 'Your tip was published',
      bodySv: 'Ditt evenemang är nu synligt.',
      bodyEn: 'Your event is now visible.',
      kind: 'tip',
      tipStatus: 'published',
    };
    expect(notificationMessageFields(message)).toMatchObject({
      titleSv: 'Ditt tips har publicerats',
      bodyEn: 'Your event is now visible.',
      tipStatus: 'published',
    });
    expect(notificationMessageFields({ ...message, kind: 'event' }).tipStatus).toBeNull();
    expect(notificationMessageFields(null)).toEqual({
      titleSv: null,
      titleEn: null,
      bodySv: null,
      bodyEn: null,
      tipStatus: null,
    });
  });

  it('documents OpenAPI paths', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/me/notifications']).toBeDefined();
    expect(doc.paths['/me/notifications/read']).toBeDefined();
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
      tagIds: [],
      featured: false,
      sponsored: false,
      posterUrl: null,
      imageFocal: null,
      imageUrl: null,
      imageUrls: [],
      checkInEnabled: false,
      meta: {},
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
      titleSv: null,
      bodySv: null,
      tipStatus: null,
      readAt: null,
    });

    const notificationId = '11111111-1111-4111-8111-111111111401';
    store.notifications.set(notificationId, {
      id: notificationId,
      userId: session.userId,
      eventId,
      reason: 'nearby',
      pushState: 'sent',
      sentAt: new Date('2026-06-15T22:00:00.000Z'),
      pushedAt: null,
      readAt: null,
    });
    const stranger = await createUserSession(app);
    const unreadBefore = await app.request('/v1/me/notifications/read', { method: 'POST' });
    expect(unreadBefore.status).toBe(401);
    const deniedRead = await app.request(`/v1/me/notifications/${notificationId}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${stranger.sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ read: true }),
    });
    expect(deniedRead.status).toBe(404);
    const marked = await app.request(`/v1/me/notifications/${notificationId}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ read: true }),
    });
    expect(marked.status).toBe(200);
    expect(await marked.json()).toEqual({ ok: true });
    const afterRead = (await (
      await app.request('/v1/me/notifications', { headers: authHeader })
    ).json()) as { items: Array<{ id: string; readAt: string | null }>; unreadCount: number };
    expect(afterRead.unreadCount).toBe(1);
    expect(afterRead.items.find((item) => item.id === notificationId)?.readAt).toEqual(
      expect.any(String),
    );
    const unreadAgain = await app.request(`/v1/me/notifications/${notificationId}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ read: false }),
    });
    expect(unreadAgain.status).toBe(200);
    expect(await unreadAgain.json()).toEqual({ ok: true });
    const allRead = await app.request('/v1/me/notifications/read', {
      method: 'POST',
      headers: authHeader,
    });
    expect(allRead.status).toBe(200);
    expect(await allRead.json()).toEqual({ ok: true });
    const cleared = (await (
      await app.request('/v1/me/notifications', { headers: authHeader })
    ).json()) as { unreadCount: number };
    expect(cleared.unreadCount).toBe(0);

    const quiet = await app.request('/v1/me/quiet-hours', {
      method: 'PUT',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false, startMin: 23 * 60, endMin: 7 * 60 }),
    });
    store.notifications.set(notificationId, {
      id: notificationId,
      userId: session.userId,
      eventId,
      reason: 'nearby',
      pushState: 'sent',
      sentAt: new Date('2026-06-15T22:00:00.000Z'),
      pushedAt: null,
      readAt: null,
    });
    const denied = await app.request(`/v1/me/notifications/${notificationId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${stranger.sessionToken}` },
    });
    expect(denied.status).toBe(404);
    const deleted = await app.request(`/v1/me/notifications/${notificationId}`, {
      method: 'DELETE',
      headers: authHeader,
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    const after = (await (
      await app.request('/v1/me/notifications', { headers: authHeader })
    ).json()) as { items: Array<{ id: string }> };
    expect(after.items.some((item) => item.id === notificationId)).toBe(false);
    const again = await app.request(`/v1/me/notifications/${notificationId}`, {
      method: 'DELETE',
      headers: authHeader,
    });
    expect(again.status).toBe(404);

    expect(quiet.status).toBe(200);
    expect(await quiet.json()).toEqual({
      enabled: false,
      startMin: 23 * 60,
      endMin: 7 * 60,
      timezone: 'Europe/Stockholm',
    });
  });
});
