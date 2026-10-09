import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import {
  createMemoryStore,
  SEED_REGION_SODERHAMN_ID,
} from '../../../apps/api/src/services/memory-store';
import { createMemoryPreferenceServices } from '../../../apps/api/src/services/preferences/memory';
import { createMemoryRegionServices } from '../../../apps/api/src/services/regions/memory';

describe('regions', () => {
  it('documents lookup in OpenAPI', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/regions/lookup']).toBeDefined();
  });

  it('looks up Söderhamn for the launch-area point', async () => {
    const app = createApp();
    const res = await app.request('/v1/regions/lookup?lat=61.3037&lng=17.0592');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      region: {
        id: SEED_REGION_SODERHAMN_ID,
        name: 'Söderhamn',
        kind: 'municipality',
        code: '2180',
      },
    });
  });

  it('returns null outside seeded fixtures', async () => {
    const app = createApp();
    const res = await app.request('/v1/regions/lookup?lat=59.33&lng=18.07');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ region: null });
  });

  it('saves a region subscription onto the user', async () => {
    const store = createMemoryStore();
    const env = { includeVerificationToken: true, now: () => new Date() };
    const auth = createMemoryAuthServices(env, store);
    const preferences = createMemoryPreferenceServices(auth, { now: env.now }, store);
    const regions = createMemoryRegionServices(store);
    const app = createApp({ auth, preferences, regions });

    const created = await app.request('/v1/identities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'ios', locale: 'sv' }),
    });
    const session = (await created.json()) as { sessionToken: string };

    const area = await app.request('/v1/me/areas', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Söderhamn',
        regionId: SEED_REGION_SODERHAMN_ID,
        notify: true,
      }),
    });
    expect(area.status).toBe(201);
    expect(await area.json()).toMatchObject({
      kind: 'region',
      origin: 'suggested',
      regionId: SEED_REGION_SODERHAMN_ID,
      name: 'Söderhamn',
    });
  });
});
