import { describe, expect, it } from 'vitest';
import { ReplaceUserInterestsRequest } from '../../../packages/contracts/src/preferences';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { createMemoryPreferenceServices } from '../../../apps/api/src/services/preferences/memory';
import { createMemoryStore } from '../../../apps/api/src/services/memory-store';
import { SEED_TAGS } from '../../../packages/db/src/seed-tags';

const SPORT = SEED_TAGS[2]!.id;
const BANDY = SEED_TAGS[3]!.id;

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
  it('accepts a full onboarding interest selection', () => {
    const tagIds = Array.from({ length: 60 }, () => crypto.randomUUID());
    expect(ReplaceUserInterestsRequest.safeParse({ tagIds }).success).toBe(true);
    expect(ReplaceUserInterestsRequest.safeParse({ tagIds: [...tagIds, ...tagIds, ...tagIds] }).success).toBe(
      false,
    );
  });

  it('documents OpenAPI paths', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/me/preferences']).toBeDefined();
    expect(doc.paths['/me/interests']).toBeDefined();
    expect(doc.paths['/me/areas']).toBeDefined();
    expect(doc.paths['/me/areas/{id}']).toBeDefined();
    expect(doc.paths['/me/profile']).toBeDefined();
    expect(doc.paths['/me/travel-distance']).toBeDefined();
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
      tagIds: [],
      areas: [],
      quietHours: {
        enabled: true,
        startMin: 22 * 60,
        endMin: 8 * 60,
        timezone: 'Europe/Stockholm',
      },
      travelDistanceM: 25_000,
    });

    const interests = await app.request('/v1/me/interests', {
      method: 'PUT',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ tagIds: [SPORT, BANDY] }),
    });
    expect(interests.status).toBe(200);
    expect(await interests.json()).toEqual({ tagIds: [SPORT, BANDY] });

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
    const circleBody = (await circle.json()) as { id: string; radiusM: number; tagIds: string[] };
    expect(circleBody.radiusM).toBe(15_000);
    expect(circleBody.tagIds).toEqual([]);

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
      tagIds: string[];
      areas: { id: string }[];
    };
    expect(prefsBody.tagIds).toEqual([SPORT, BANDY]);
    expect(prefsBody.areas).toHaveLength(2);

    const patched = await app.request(`/v1/me/areas/${circleBody.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Home', notify: false }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ name: 'Home', notify: false });

    const withTags = await app.request(`/v1/me/areas/${circleBody.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ tagIds: [SPORT, BANDY] }),
    });
    expect(withTags.status).toBe(200);
    expect(await withTags.json()).toMatchObject({ tagIds: [SPORT, BANDY] });

    const clearedTags = await app.request(`/v1/me/areas/${circleBody.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ tagIds: [] }),
    });
    expect(clearedTags.status).toBe(200);
    expect(await clearedTags.json()).toMatchObject({ tagIds: [] });

    const unknownTag = await app.request(`/v1/me/areas/${circleBody.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ tagIds: ['00000000-0000-4000-8000-000000000099'] }),
    });
    expect(unknownTag.status).toBe(400);
    expect(await unknownTag.json()).toMatchObject({ error: { code: 'unknown_tag' } });

    const deleted = await app.request(`/v1/me/areas/${circleBody.id}`, {
      method: 'DELETE',
      headers: authHeader,
    });
    expect(deleted.status).toBe(204);

    const after = await app.request('/v1/me/areas', { headers: authHeader });
    expect((await after.json()) as { items: unknown[] }).toMatchObject({
      items: [{ name: 'Drawn' }],
    });

    const rejected = await app.request('/v1/me/travel-distance', {
      method: 'PUT',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ distanceM: 500 }),
    });
    expect(rejected.status).toBe(400);

    const updatedDistance = await app.request('/v1/me/travel-distance', {
      method: 'PUT',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ distanceM: 50_000 }),
    });
    expect(updatedDistance.status).toBe(200);
    expect(await updatedDistance.json()).toEqual({ distanceM: 50_000 });

    const withDistance = await app.request('/v1/me/preferences', { headers: authHeader });
    expect(await withDistance.json()).toMatchObject({ travelDistanceM: 50_000 });
  });

  it('rejects unauthenticated and unknown tags', async () => {
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
      body: JSON.stringify({ tagIds: ['00000000-0000-4000-8000-000000000099'] }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: 'unknown_tag' } });
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

  it('sets named or anonymous profile with optional recovery email', async () => {
    const store = createMemoryStore();
    const env = { includeVerificationToken: true, now: () => new Date() };
    const auth = createMemoryAuthServices(env, store);
    const preferences = createMemoryPreferenceServices(auth, { now: env.now }, store);
    const app = createApp({ auth, preferences });

    const session = await createUserSession(app);
    const authHeader = {
      authorization: `Bearer ${session.sessionToken}`,
      'content-type': 'application/json',
    };

    const initial = await app.request('/v1/me/profile', {
      headers: { authorization: `Bearer ${session.sessionToken}` },
    });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      profileChosen: false,
      displayName: null,
      isPublic: false,
      recoveryEmail: null,
    });

    const named = await app.request('/v1/me/profile', {
      method: 'PUT',
      headers: authHeader,
      body: JSON.stringify({
        choice: 'named',
        displayName: 'Mia',
        recoveryEmail: 'mia@example.com',
      }),
    });
    expect(named.status).toBe(200);
    expect(await named.json()).toMatchObject({
      profileChosen: true,
      displayName: 'Mia',
      isPublic: true,
      recoveryEmail: 'mia@example.com',
      recoveryEmailVerified: false,
    });

    const other = await createUserSession(app);
    const anon = await app.request('/v1/me/profile', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${other.sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ choice: 'anonymous' }),
    });
    expect(anon.status).toBe(200);
    expect(await anon.json()).toMatchObject({
      profileChosen: true,
      displayName: null,
      isPublic: false,
    });

    const bad = await app.request('/v1/me/profile', {
      method: 'PUT',
      headers: authHeader,
      body: JSON.stringify({ choice: 'named', displayName: 'x' }),
    });
    expect(bad.status).toBe(400);
  });
});
