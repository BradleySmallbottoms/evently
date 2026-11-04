import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/admin-api/src/app';
import {
  createAdminMemoryAuthStore,
  createMemoryAdminAuthServices,
} from '../../../apps/admin-api/src/services/auth/memory';
import {
  createMemoryAdminPublisherServices,
  type AdminMemoryStore,
} from '../../../apps/admin-api/src/services/publishers';
import { generateTotpCode, hashPassword } from '../../../packages/auth/src/index';

const PUBLISHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function adminApp() {
  const authStore = createAdminMemoryAuthStore();
  authStore.admins.set('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'admin@example.com',
    passwordHash: await hashPassword('admin-password-long'),
    totpSecret: 'JBSWY3DPEHPK3PXP',
    role: 'admin',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  });
  const publisherStore: AdminMemoryStore = {
    publishers: new Map([
      [
        PUBLISHER_ID,
        {
          id: PUBLISHER_ID,
          name: 'Café',
          slug: 'cafe',
          type: 'org',
          status: 'published',
          origin: 'native',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    ]),
    events: new Map(),
  };
  const app = createApp({
    auth: createMemoryAdminAuthServices(authStore, {
      now: () => new Date('2026-06-15T12:00:00.000Z'),
    }),
    publishers: createMemoryAdminPublisherServices(publisherStore, {
      now: () => new Date('2026-06-15T12:00:00.000Z'),
    }),
  });
  const login = await app.request('/v1/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'admin-password-long' }),
  });
  const challenge = (await login.json()) as { challengeToken: string };
  const totp = await app.request('/v1/admin/login/totp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: challenge.challengeToken,
      code: generateTotpCode('JBSWY3DPEHPK3PXP', Date.parse('2026-06-15T12:00:00.000Z')),
    }),
  });
  const cookie = (totp.headers.get('set-cookie') ?? '').split(';')[0]!;
  return { app, cookie, publisherStore };
}

describe('admin publisher accounts', () => {
  it('lists, adds, edits, and removes accounts on a publisher', async () => {
    const { app, cookie, publisherStore } = await adminApp();
    const headers = { cookie, 'content-type': 'application/json' };

    const unknown = await app.request(
      `/v1/publishers/${PUBLISHER_ID}/accounts/lookup?email=owner@example.com`,
      { headers },
    );
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ status: 'new' });

    const missingPassword = await app.request(`/v1/publishers/${PUBLISHER_ID}/accounts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'owner@example.com', role: 'owner' }),
    });
    expect(missingPassword.status).toBe(400);

    const empty = await app.request(`/v1/publishers/${PUBLISHER_ID}/accounts`, { headers });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ items: [] });

    const created = await app.request(`/v1/publishers/${PUBLISHER_ID}/accounts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'Owner@Example.com',
        password: 'long-enough-password',
        role: 'owner',
      }),
    });
    expect(created.status).toBe(201);
    const account = (await created.json()) as { id: string; email: string; role: string };
    expect(account).toMatchObject({
      email: 'owner@example.com',
      role: 'owner',
      totpEnabled: false,
      emailVerifiedAt: '2026-06-15T12:00:00.000Z',
    });

    const again = await app.request(`/v1/publishers/${PUBLISHER_ID}/accounts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'owner@example.com',
        password: 'long-enough-password',
        role: 'editor',
      }),
    });
    expect(again.status).toBe(409);

    const otherId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    publisherStore.publishers.set(otherId, {
      id: otherId,
      name: 'Other',
      slug: 'other',
      type: 'person',
      status: 'in_review',
      origin: 'native',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    });
    const found = await app.request(
      `/v1/publishers/${otherId}/accounts/lookup?email=owner@example.com`,
      { headers },
    );
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ status: 'existing' });
    const passwordHash = publisherStore.accounts?.get(account.id)?.passwordHash;
    const attached = await app.request(`/v1/publishers/${otherId}/accounts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'owner@example.com',
        role: 'editor',
      }),
    });
    expect(attached.status).toBe(201);
    expect(await attached.json()).toMatchObject({ id: account.id, role: 'editor' });
    expect(publisherStore.accounts?.get(account.id)?.passwordHash).toBe(passwordHash);
    const member = await app.request(
      `/v1/publishers/${PUBLISHER_ID}/accounts/lookup?email=owner@example.com`,
      { headers },
    );
    expect(member.status).toBe(200);
    expect(await member.json()).toEqual({ status: 'already_member' });

    const roleOnly = await app.request(`/v1/publishers/${PUBLISHER_ID}/accounts/${account.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ role: 'editor' }),
    });
    expect(roleOnly.status).toBe(200);
    expect(await roleOnly.json()).toMatchObject({ role: 'editor', email: 'owner@example.com' });

    const edited = await app.request(`/v1/publishers/${PUBLISHER_ID}/accounts/${account.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ role: 'owner' }),
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ email: 'owner@example.com', role: 'owner' });

    const removed = await app.request(`/v1/publishers/${PUBLISHER_ID}/accounts/${account.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(removed.status).toBe(204);
    const left = await app.request(`/v1/publishers/${otherId}/accounts`, { headers });
    expect(await left.json()).toMatchObject({
      items: [{ id: account.id, email: 'owner@example.com' }],
    });

    const gone = await app.request(`/v1/publishers/${otherId}/accounts/${account.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(gone.status).toBe(204);
    expect(publisherStore.accounts?.has(account.id)).toBe(true);

    const directory = await app.request('/v1/publisher-accounts', { headers });
    expect(directory.status).toBe(200);
    expect(await directory.json()).toMatchObject({
      items: [{ id: account.id, email: 'owner@example.com', totpEnabled: false }],
    });
    const changed = await app.request(`/v1/publisher-accounts/${account.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ password: 'replaced-long-password' }),
    });
    expect(changed.status).toBe(204);
    expect(publisherStore.accounts?.get(account.id)?.passwordHash).not.toBe(passwordHash);
    const missingAccount = await app.request(
      '/v1/publisher-accounts/dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ password: 'replaced-long-password' }),
      },
    );
    expect(missingAccount.status).toBe(404);

    const missing = await app.request(`/v1/publishers/${PUBLISHER_ID}/accounts`, {
      headers: { 'content-type': 'application/json' },
    });
    expect(missing.status).toBe(401);
  });
});
