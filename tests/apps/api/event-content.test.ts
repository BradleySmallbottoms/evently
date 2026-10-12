import { PUBLISHER_SESSION_COOKIE } from '../../../packages/auth/src/index';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { createMemoryCheckInServices } from '../../../apps/api/src/services/check-ins/memory';
import { createMemoryEventContentServices } from '../../../apps/api/src/services/event-content/memory';
import { createMemoryEventServices } from '../../../apps/api/src/services/events/memory';
import { SEED_TAGS } from '../../../packages/db/src/seed-tags';
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

describe('event content', () => {
  it('documents OpenAPI paths', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/events/{eventId}/content']).toBeDefined();
    expect(doc.paths['/manage/events/{eventId}/content']).toBeDefined();
    expect(doc.paths['/manage/content/{contentId}']).toBeDefined();
  });

  it('hides attendee-only items until check-in and signs file URLs', async () => {
    const store = createMemoryStore();
    const now = new Date('2026-06-15T18:00:00.000Z');
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => now },
      store,
    );
    const events = createMemoryEventServices(auth, { now: () => now }, store);
    const checkIns = createMemoryCheckInServices(auth, { now: () => now }, store);
    const eventContent = createMemoryEventContentServices(auth, { now: () => now }, store);
    const app = createApp({ auth, events, checkIns, eventContent });

    const email = `content-${now.getTime()}@example.com`;
    const registered = await app.request('/v1/publishers/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'long-enough-password',
        name: 'Content Org',
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
        title: 'Content gig',
        mode: 'physical',
        startsAt: '2026-06-15T18:10:00.000Z',
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
    const published = store.events.get(eventId);
    if (published) published.checkInEnabled = true;

    const addPublic = await app.request(`/v1/manage/events/${eventId}/content`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        kind: 'info',
        title: 'Public note',
        body: 'Anyone can see this',
        visibility: 'public',
      }),
    });
    expect(addPublic.status).toBe(201);

    const addPrivate = await app.request(`/v1/manage/events/${eventId}/content`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        kind: 'file',
        title: 'Venue map',
        s3Key: `events/${eventId}/map.pdf`,
        visibility: 'attendees',
      }),
    });
    expect(addPrivate.status).toBe(201);
    const privateItem = (await addPrivate.json()) as { id: string; url: string };
    expect(privateItem.url).toContain('files.local/signed');

    const anon = await app.request(`/v1/events/${eventId}/content`);
    expect(anon.status).toBe(200);
    const anonBody = (await anon.json()) as {
      checkedIn: boolean;
      items: { title: string }[];
    };
    expect(anonBody.checkedIn).toBe(false);
    expect(anonBody.items.map((i) => i.title)).toEqual(['Public note']);

    const session = await createUserSession(app);
    const authHeader = {
      authorization: `Bearer ${session.sessionToken}`,
      'content-type': 'application/json',
    };
    await app.request(`/v1/events/${eventId}/check-ins`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        location: { lat: 61.3037, lng: 17.0592 },
        accuracyM: 20,
      }),
    });

    const after = await app.request(`/v1/events/${eventId}/content`, {
      headers: { authorization: `Bearer ${session.sessionToken}` },
    });
    expect(after.status).toBe(200);
    const afterBody = (await after.json()) as {
      checkedIn: boolean;
      items: { title: string; url: string | null }[];
    };
    expect(afterBody.checkedIn).toBe(true);
    expect(afterBody.items.map((i) => i.title).sort()).toEqual(['Public note', 'Venue map']);
    expect(afterBody.items.find((i) => i.title === 'Venue map')?.url).toContain('map.pdf');
  });
});
