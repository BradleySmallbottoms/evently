import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createMemoryAuthServices } from './auth/memory';
import { PUBLISHER_SESSION_COOKIE } from '@local-events/auth';

describe('public api', () => {
  it('responds on /health', async () => {
    const res = await createApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'api' });
  });

  it('serves the OpenAPI document with identity and publisher routes', async () => {
    const res = await createApp().request('/v1/openapi.json');
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths['/health']).toBeDefined();
    expect(doc.paths['/v1/identities']).toBeDefined();
    expect(doc.paths['/v1/sessions']).toBeDefined();
    expect(doc.paths['/v1/publishers/register']).toBeDefined();
    expect(doc.paths['/v1/publishers/login']).toBeDefined();
  });
});

describe('identity + sessions', () => {
  it('creates an anonymous identity and exchanges the device credential', async () => {
    const app = createApp({ auth: createMemoryAuthServices() });

    const created = await app.request('/v1/identities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'ios', locale: 'sv' }),
    });
    expect(created.status).toBe(201);
    const identity = (await created.json()) as {
      userId: string;
      deviceCredential: string;
      sessionToken: string;
    };
    expect(identity.userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(identity.deviceCredential.length).toBeGreaterThan(20);
    expect(identity.sessionToken.length).toBeGreaterThan(20);

    const session = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceCredential: identity.deviceCredential }),
    });
    expect(session.status).toBe(200);
    const body = (await session.json()) as { userId: string; sessionToken: string };
    expect(body.userId).toBe(identity.userId);
    expect(body.sessionToken).not.toBe(identity.sessionToken);

    const bad = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceCredential: 'not-a-real-credential' }),
    });
    expect(bad.status).toBe(401);
  });
});

describe('publisher auth', () => {
  it('registers, verifies email, logs in with a cookie, and returns me', async () => {
    const app = createApp({
      auth: createMemoryAuthServices({ isProduction: false, now: () => new Date() }),
    });

    const registered = await app.request('/v1/publishers/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'org@example.com',
        password: 'long-enough-password',
        name: 'Café Söderhamn',
        type: 'org',
      }),
    });
    expect(registered.status).toBe(201);
    const reg = (await registered.json()) as {
      publisherAccountId: string;
      publisherId: string;
      verificationToken?: string;
    };
    expect(reg.verificationToken).toBeTruthy();

    const beforeVerify = await app.request('/v1/publishers/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'org@example.com', password: 'long-enough-password' }),
    });
    expect(beforeVerify.status).toBe(403);

    const verified = await app.request('/v1/publishers/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: reg.verificationToken }),
    });
    expect(verified.status).toBe(200);

    const login = await app.request('/v1/publishers/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'org@example.com', password: 'long-enough-password' }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(PUBLISHER_SESSION_COOKIE);
    const loginBody = (await login.json()) as {
      publisherAccountId: string;
      publishers: { name: string; role: string }[];
    };
    expect(loginBody.publisherAccountId).toBe(reg.publisherAccountId);
    expect(loginBody.publishers[0]?.name).toBe('Café Söderhamn');
    expect(loginBody.publishers[0]?.role).toBe('owner');

    const me = await app.request('/v1/publishers/me', {
      headers: { cookie: setCookie.split(';')[0]! },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: 'org@example.com' });
  });
});
