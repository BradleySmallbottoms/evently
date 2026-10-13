import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { createMemoryStore } from '../../../apps/api/src/services/memory-store';
import { createMemoryReportServices } from '../../../apps/api/src/services/reports/memory';

async function createUserSession(app: ReturnType<typeof createApp>) {
  const created = await app.request('/v1/identities', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'ios', locale: 'sv' }),
  });
  expect(created.status).toBe(201);
  return (await created.json()) as { sessionToken: string; userId: string };
}

const eventId = '11111111-1111-4111-8111-111111111501';

function publishedEvent() {
  const at = '2026-06-01T18:00:00.000Z';
  return {
    id: eventId,
    publisherId: '11111111-1111-4111-8111-111111111502',
    title: 'Reported gig',
    description: null,
    mode: 'physical' as const,
    status: 'published' as const,
    origin: 'native' as const,
    startsAt: at,
    endsAt: at,
    timezone: 'Europe/Stockholm',
    venueName: 'Hall',
    location: { lat: 61.3, lng: 17.05 },
    geofenceRadiusM: 100,
    onlineUrl: null,
    priceAmount: null,
    currency: 'SEK',
    publisherName: 'Hall',
    links: [],
    imageUrl: null,
    imageUrls: [],
    tagIds: [],
    featured: false,
    checkInEnabled: false,
    numSaved: 0,
    numComing: 0,
    createdAt: at,
    updatedAt: at,
    startsAtDate: new Date(at),
    endsAtDate: new Date(at),
  };
}

describe('event reports', () => {
  it('documents the OpenAPI path', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/events/{eventId}/reports']).toBeDefined();
  });

  it('stores one report per user and rejects a missing session or unpublished event', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const reports = createMemoryReportServices(auth, store);
    const app = createApp({ auth, reports });
    store.events.set(eventId, publishedEvent());

    const session = await createUserSession(app);
    const headers = { authorization: `Bearer ${session.sessionToken}` };

    const missing = await app.request(`/v1/events/${eventId}/reports`, { method: 'POST' });
    expect(missing.status).toBe(401);

    const created = await app.request(`/v1/events/${eventId}/reports`, {
      method: 'POST',
      headers,
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; eventId: string };
    expect(body.eventId).toBe(eventId);
    expect(store.eventReports).toHaveLength(1);

    const again = await app.request(`/v1/events/${eventId}/reports`, {
      method: 'POST',
      headers,
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { id: string }).id).toBe(body.id);
    expect(store.eventReports).toHaveLength(1);

    store.events.get(eventId)!.status = 'draft';
    const hidden = await app.request(`/v1/events/${eventId}/reports`, {
      method: 'POST',
      headers,
    });
    expect(hidden.status).toBe(404);
  });
});
