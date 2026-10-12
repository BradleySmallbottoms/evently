import { generateTotpCode, hashPassword } from '../../../packages/auth/src/index';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/admin-api/src/app';
import {
  createAdminMemoryAuthStore,
  createMemoryAdminAuthServices,
} from '../../../apps/admin-api/src/services/auth/memory';
import { createMemoryDomainEventPublisher } from '../../../apps/admin-api/src/services/domain-events/memory';
import { createMemoryAdminPublisherServices } from '../../../apps/admin-api/src/services/publishers';

async function seededAuth() {
  const store = createAdminMemoryAuthStore();
  const passwordHash = await hashPassword('admin-password-long');
  store.admins.set('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'admin@example.com',
    passwordHash,
    totpSecret: 'JBSWY3DPEHPK3PXP',
    role: 'admin',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  });
  const auth = createMemoryAdminAuthServices(store, {
    now: () => new Date('2026-06-15T12:00:00.000Z'),
  });
  return { store, auth };
}

async function loginSession(app: ReturnType<typeof createApp>) {
  const login = await app.request('/v1/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'admin-password-long' }),
  });
  expect(login.status).toBe(200);
  const challenge = (await login.json()) as { status: string; challengeToken: string };
  expect(challenge.status).toBe('totp_required');
  const code = generateTotpCode('JBSWY3DPEHPK3PXP', Date.parse('2026-06-15T12:00:00.000Z'));
  const totp = await app.request('/v1/admin/login/totp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: challenge.challengeToken, code }),
  });
  expect(totp.status).toBe(200);
  const cookie = (totp.headers.get('set-cookie') ?? '').split(';')[0]!;
  expect(cookie).toContain('le_admin_session=');
  return cookie;
}

describe('admin api', () => {
  it('responds on /health', async () => {
    const res = await createApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'admin-api' });
  });

  it('serves OpenAPI with auth and publisher routes', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/admin/login']).toBeDefined();
    expect(doc.paths['/admin/login/totp']).toBeDefined();
    expect(doc.paths['/publishers']).toBeDefined();
    expect(doc.paths['/publishers/{id}/verify']).toBeDefined();
  });

  it('rejects publisher list without session', async () => {
    const { auth } = await seededAuth();
    const app = createApp({ auth });
    const list = await app.request('/v1/publishers?verified=false');
    expect(list.status).toBe(401);
  });

  it('logs in with password + TOTP and verifies publishers', async () => {
    const { auth } = await seededAuth();
    const publishers = new Map([
      [
        '22222222-2222-4222-8222-222222222201',
        {
          id: '22222222-2222-4222-8222-222222222201',
          name: 'Cafe',
          slug: 'cafe',
          type: 'org' as const,
          verified: false,
          origin: 'native' as const,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    ]);
    const events = new Map([
      [
        '33333333-3333-4333-8333-333333333301',
        {
          id: '33333333-3333-4333-8333-333333333301',
          publisherId: '22222222-2222-4222-8222-222222222201',
          status: 'awaiting_verification',
          endsAtDate: new Date('2026-12-01T21:00:00Z'),
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    ]);
    const domainEvents = createMemoryDomainEventPublisher();
    const app = createApp({
      auth,
      publishers: createMemoryAdminPublisherServices({ publishers, events }, { domainEvents }),
    });

    const cookie = await loginSession(app);

    const list = await app.request('/v1/publishers?verified=false', {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(1);

    const verify = await app.request(
      '/v1/publishers/22222222-2222-4222-8222-222222222201/verify',
      { method: 'POST', headers: { cookie } },
    );
    expect(verify.status).toBe(200);
    expect(await verify.json()).toMatchObject({
      verified: true,
      releasedEventCount: 1,
    });
    expect(events.get('33333333-3333-4333-8333-333333333301')?.status).toBe('published');
    expect(domainEvents.events).toEqual([
      {
        type: 'event.published',
        eventId: '33333333-3333-4333-8333-333333333301',
      },
    ]);
  });

  it('enrolls TOTP on first login when secret is unset', async () => {
    const store = createAdminMemoryAuthStore();
    store.admins.set('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      email: 'new@example.com',
      passwordHash: await hashPassword('admin-password-long'),
      totpSecret: null,
      role: 'admin',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const now = () => new Date('2026-06-15T12:00:00.000Z');
    const auth = createMemoryAdminAuthServices(store, { now });
    const app = createApp({ auth });

    const login = await app.request('/v1/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', password: 'admin-password-long' }),
    });
    expect(login.status).toBe(200);
    const setup = (await login.json()) as {
      status: string;
      setupToken: string;
      secret: string;
    };
    expect(setup.status).toBe('totp_setup');
    const code = generateTotpCode(setup.secret, now().getTime());
    const confirm = await app.request('/v1/admin/login/totp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: setup.setupToken, code }),
    });
    expect(confirm.status).toBe(200);
    expect(store.admins.get('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')?.totpSecret).toBe(
      setup.secret,
    );
  });
});
