import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { createMemoryPreferenceServices } from '../../../apps/api/src/services/preferences/memory';
import { createMemoryStore } from '../../../apps/api/src/services/memory-store';

const MUSIC = '11111111-1111-4111-8111-111111111101';
const CULTURE = '11111111-1111-4111-8111-111111111102';

async function createUserSession(app: ReturnType<typeof createApp>) {
  const created = await app.request('/v1/identities', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'ios', locale: 'sv' }),
  });
  expect(created.status).toBe(201);
  const body = (await created.json()) as { sessionToken: string; userId: string };
  return body;
}

describe('user preferences', () => {
  it('documents OpenAPI paths', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/me/preferences']).toBeDefined();
    expect(doc.paths['/me/interests']).toBeDefined();
    expect(doc.paths['/me/areas']).toBeDefined();
    expect(doc.paths['/me/areas/{id}']).toBeDefined();
  });

  it('replaces interests and CRUD circle + polygon areas with Bearer auth', async () => {
    const store = createMemoryStore();
    const env = { includeVerificationToken: true, now: () => new Date() };
    const auth = createMemoryAuthServices(env, store);
    const preferences = createMemoryPreferenceServices(auth, { now: env.now }, store);
    const app = createApp({ auth, preferences });

    const session = await createUserSession(app);
    const authHeader = { authorization: `Bearer ${session.sessionToken}` };

    const empty = await app.request('/v1/me/preferences', { headers: authHeader });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({
      categoryIds: [],
      areas: [],
      quietHours: {
        enabled: true,
        startMin: 22 * 60,
        endMin: 8 * 60,
        timezone: 'Europe/Stockholm',
      },
    });

    const interests = await app.request('/v1/me/interests', {
      method: 'PUT',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ categoryIds: [MUSIC, CULTURE] }),
    });
    expect(interests.status).toBe(200);
    expect(await interests.json()).toEqual({ categoryIds: [MUSIC, CULTURE] });

    const circle = await app.request('/v1/me/areas', {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Near home',
        center: { lat: 61.3, lng: 17.05 },
        radiusM: 15_000,
      }),
    });
    expect(circle.status).toBe(201);
    const circleBody = (await circle.json()) as { id: string; radiusM: number };
    expect(circleBody.radiusM).toBe(15_000);

    const polygon = await app.request('/v1/me/areas', {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Drawn',
        polygon: [
          { lat: 61.3, lng: 17.0 },
          { lat: 61.31, lng: 17.0 },
          { lat: 61.31, lng: 17.02 },
          { lat: 61.3, lng: 17.02 },
        ],
      }),
    });
    expect(polygon.status).toBe(201);
    const polyBody = (await polygon.json()) as { polygon: { lat: number }[] | null };
    expect(polyBody.polygon?.length).toBeGreaterThanOrEqual(4);

    const prefs = await app.request('/v1/me/preferences', { headers: authHeader });
    const prefsBody = (await prefs.json()) as {
      categoryIds: string[];
      areas: { id: string }[];
    };
    expect(prefsBody.categoryIds).toEqual([MUSIC, CULTURE]);
    expect(prefsBody.areas).toHaveLength(2);

    const patched = await app.request(`/v1/me/areas/${circleBody.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Home', notify: false }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ name: 'Home', notify: false });

    const deleted = await app.request(`/v1/me/areas/${circleBody.id}`, {
      method: 'DELETE',
      headers: authHeader,
    });
    expect(deleted.status).toBe(204);

    const after = await app.request('/v1/me/areas', { headers: authHeader });
    expect((await after.json()) as { items: unknown[] }).toMatchObject({
      items: [{ name: 'Drawn' }],
    });
  });

  it('rejects unauthenticated and unknown categories', async () => {
    const app = createApp();
    const unauth = await app.request('/v1/me/preferences');
    expect(unauth.status).toBe(401);

    const session = await createUserSession(app);
    const bad = await app.request('/v1/me/interests', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${session.sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ categoryIds: ['00000000-0000-4000-8000-000000000099'] }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: 'unknown_category' } });
  });

  it('rejects cross-user area mutations', async () => {
    const store = createMemoryStore();
    const env = { includeVerificationToken: true, now: () => new Date() };
    const auth = createMemoryAuthServices(env, store);
    const preferences = createMemoryPreferenceServices(auth, { now: env.now }, store);
    const app = createApp({ auth, preferences });

    const owner = await createUserSession(app);
    const other = await createUserSession(app);
    const created = await app.request('/v1/me/areas', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner.sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Owner area',
        center: { lat: 61.3, lng: 17.05 },
        radiusM: 10_000,
      }),
    });
    const area = (await created.json()) as { id: string };

    const patched = await app.request(`/v1/me/areas/${area.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${other.sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Hijack' }),
    });
    expect(patched.status).toBe(404);

    const deleted = await app.request(`/v1/me/areas/${area.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${other.sessionToken}` },
    });
    expect(deleted.status).toBe(404);
  });
});
