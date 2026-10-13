import { randomUUID } from 'node:crypto';
import { PUBLISHER_SESSION_COOKIE } from '../../../packages/auth/src/index';
import type { PushMessageRow } from '../../../packages/db/src/push-messages';
import { SEED_TAGS } from '../../../packages/db/src/seed-tags';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { createMemoryEventServices } from '../../../apps/api/src/services/events/memory';
import { createMemoryStore } from '../../../apps/api/src/services/memory-store';
import { createMemoryPublisherPushMessageServices } from '../../../apps/api/src/services/push-messages/memory';

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

function pushRow(
  eventId: string,
  status: PushMessageRow['status'],
  sentAt: Date | null,
): PushMessageRow {
  const now = new Date('2026-06-01T12:00:00.000Z');
  return {
    id: randomUUID(),
    eventId,
    kind: 'event',
    audience: 'event_match',
    audienceTagId: null,
    status,
    titleSv: 'Hej',
    bodySv: 'Kom',
    titleEn: 'Hi',
    bodyEn: 'Come',
    sendAt: sentAt,
    copyEdited: false,
    approvedAt: now,
    approvedByAdminId: null,
    sentAt,
    createdAt: now,
    updatedAt: now,
  };
}

describe('sent event notifications', () => {
  it('lists sent messages for a publisher member and counts distinct people', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date('2026-06-15T12:00:00.000Z') },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => new Date() }, store);
    const pushMessages = createMemoryPublisherPushMessageServices(auth, store);
    const app = createApp({ auth, events, pushMessages });
    const { publisherId, cookie } = await registerAndLogin(app, 'sent-notes@example.com');

    const created = await app.request(`/v1/publishers/${publisherId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        title: 'Konsert i parken',
        mode: 'physical',
        startsAt: '2026-12-01T18:00:00.000Z',
        endsAt: '2026-12-01T21:00:00.000Z',
        location: { lat: 61.3037, lng: 17.0592 },
        tagIds: [SEED_TAGS[0]!.id],
      }),
    });
    expect(created.status).toBe(201);
    const eventId = ((await created.json()) as { id: string }).id;

    const sending = pushRow(eventId, 'sending', null);
    const sent = pushRow(eventId, 'sent', new Date('2026-06-02T12:00:00.000Z'));
    const later = pushRow(eventId, 'sent', new Date('2026-06-10T12:00:00.000Z'));
    const draft = pushRow(eventId, 'approved', null);
    const other = pushRow(randomUUID(), 'sent', new Date('2026-06-11T12:00:00.000Z'));
    for (const row of [sending, sent, later, draft, other]) {
      store.pushMessages!.set(row.id, row);
    }
    const base = {
      eventId,
      pushState: 'sent' as const,
      sentAt: new Date('2026-06-02T12:00:00.000Z'),
      pushedAt: null,
      readAt: null,
    };
    store.notifications.set('n1', {
      ...base,
      id: 'n1',
      userId: 'user-a',
      pushMessageId: sent.id,
      reason: 'nearby',
    });
    store.notifications.set('n2', {
      ...base,
      id: 'n2',
      userId: 'user-a',
      pushMessageId: sent.id,
      reason: 'publisher',
    });
    store.notifications.set('n3', {
      ...base,
      id: 'n3',
      userId: 'user-b',
      pushMessageId: sent.id,
      reason: 'nearby',
    });

    const denied = await app.request(`/v1/manage/events/${eventId}/sent-notifications`);
    expect(denied.status).toBe(401);

    const missing = await app.request(
      '/v1/manage/events/99999999-9999-4999-8999-999999999999/sent-notifications',
      { headers: { cookie } },
    );
    expect(missing.status).toBe(404);

    const { cookie: otherCookie } = await registerAndLogin(app, 'other-sent@example.com');
    const forbidden = await app.request(`/v1/manage/events/${eventId}/sent-notifications`, {
      headers: { cookie: otherCookie },
    });
    expect(forbidden.status).toBe(401);

    const list = await app.request(`/v1/manage/events/${eventId}/sent-notifications`, {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      items: { id: string; status: string; recipientCount: number }[];
    };
    expect(body.items.map((item) => item.id)).toEqual([sending.id, later.id, sent.id]);
    expect(body.items.find((item) => item.id === sent.id)?.recipientCount).toBe(2);
    expect(body.items.find((item) => item.id === later.id)?.recipientCount).toBe(0);
  });
});
