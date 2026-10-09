import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';
import { createMemoryStore } from '../../../apps/api/src/services/memory-store';

async function createIdentity(app: ReturnType<typeof createApp>) {
  const created = await app.request('/v1/identities', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'ios', locale: 'sv' }),
  });
  expect(created.status).toBe(201);
  return (await created.json()) as {
    sessionToken: string;
    deviceCredential: string;
    userId: string;
  };
}

describe('PUT /me/push-token', () => {
  it('documents the OpenAPI path', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/me/push-token']).toBeDefined();
  });

  it('stores the Expo push token on the device', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const app = createApp({ auth });
    const identity = await createIdentity(app);

    const res = await app.request('/v1/me/push-token', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${identity.sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        deviceCredential: identity.deviceCredential,
        expoPushToken: 'ExponentPushToken[test-token]',
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const device = [...store.devices.values()].find((d) => d.userId === identity.userId);
    expect(device?.expoPushToken).toBe('ExponentPushToken[test-token]');
  });

  it('rejects missing session', async () => {
    const app = createApp({
      auth: createMemoryAuthServices({ includeVerificationToken: true, now: () => new Date() }),
    });
    const res = await app.request('/v1/me/push-token', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceCredential: 'x',
        expoPushToken: 'ExponentPushToken[test]',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a credential that does not belong to the session user', async () => {
    const store = createMemoryStore();
    const auth = createMemoryAuthServices(
      { includeVerificationToken: true, now: () => new Date() },
      store,
    );
    const app = createApp({ auth });
    const a = await createIdentity(app);
    const b = await createIdentity(app);

    const res = await app.request('/v1/me/push-token', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${a.sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        deviceCredential: b.deviceCredential,
        expoPushToken: 'ExponentPushToken[wrong-user]',
      }),
    });
    expect(res.status).toBe(401);
  });
});
