import { generateTotpCode, PUBLISHER_SESSION_COOKIE } from '../../../packages/auth/src/index';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { createPublisherLoginMailer } from '../../../apps/api/src/services/auth/mail';
import { createMemoryAuthServices } from '../../../apps/api/src/services/auth/memory';

const NOW = new Date('2026-06-15T12:00:00.000Z');

function app() {
  return createApp({
    auth: createMemoryAuthServices({
      includeVerificationToken: true,
      includeLoginOtp: true,
      otpPepper: 'test-pepper',
      now: () => NOW,
    }),
  });
}

async function verifiedPublisher(api: ReturnType<typeof app>, email = 'org@example.com') {
  const registered = await api.request('/v1/publishers/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'long-enough-password',
      name: 'Café Söderhamn',
      type: 'org',
    }),
  });
  const reg = (await registered.json()) as { verificationToken: string };
  await api.request('/v1/publishers/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: reg.verificationToken }),
  });
  return reg;
}

async function loginCookie(api: ReturnType<typeof app>, email = 'org@example.com') {
  const login = await api.request('/v1/publishers/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'long-enough-password' }),
  });
  return (login.headers.get('set-cookie') ?? '').split(';')[0]!;
}

describe('publisher email code and authenticator', () => {
  it('signs in with a single-use email code', async () => {
    const api = app();
    await verifiedPublisher(api);

    const unknown = await api.request('/v1/publishers/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'missing@example.com' }),
    });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ status: 'code_sent' });

    const issued = await api.request('/v1/publishers/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'org@example.com' }),
    });
    expect(issued.status).toBe(200);
    const { code } = (await issued.json()) as { code: string };
    expect(code).toMatch(/^\d{6}$/);

    const replaced = await api.request('/v1/publishers/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'org@example.com' }),
    });
    const next = (await replaced.json()) as { code: string };
    const stale = await api.request('/v1/publishers/login/otp/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'org@example.com', code }),
    });
    expect(stale.status).toBe(401);

    const ok = await api.request('/v1/publishers/login/otp/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'org@example.com', code: next.code }),
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie') ?? '').toContain(PUBLISHER_SESSION_COOKIE);
    expect(await ok.json()).toMatchObject({
      status: 'authenticated',
      email: 'org@example.com',
      totpEnabled: false,
    });

    const reuse = await api.request('/v1/publishers/login/otp/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'org@example.com', code: next.code }),
    });
    expect(reuse.status).toBe(401);
  });

  it('emails a verified account and leaves the code out of the response', async () => {
    const sent: { to: string; code: string }[] = [];
    const api = createApp({
      auth: createMemoryAuthServices({
        includeVerificationToken: true,
        includeLoginOtp: false,
        otpPepper: 'test-pepper',
        now: () => NOW,
        sendPublisherLoginCode: async (input) => {
          sent.push(input);
        },
      }),
    });
    await verifiedPublisher(api);

    const hidden = await api.request('/v1/publishers/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'missing@example.com' }),
    });
    expect(await hidden.json()).toEqual({ status: 'code_sent' });
    expect(sent).toEqual([]);

    const issued = await api.request('/v1/publishers/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'org@example.com' }),
    });
    expect(issued.status).toBe(200);
    expect(await issued.json()).toEqual({ status: 'code_sent' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'org@example.com' });
    expect(sent[0]?.code).toMatch(/^\d{6}$/);

    const ok = await api.request('/v1/publishers/login/otp/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'org@example.com', code: sent[0]?.code }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: 'authenticated' });
  });

  it('does not issue a code for an unverified email and limits requests', async () => {
    const api = app();
    await api.request('/v1/publishers/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'new@example.com',
        password: 'long-enough-password',
        name: 'New Org',
        type: 'org',
      }),
    });
    const hidden = await api.request('/v1/publishers/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com' }),
    });
    expect(await hidden.json()).toEqual({ status: 'code_sent' });

    for (let i = 0; i < 4; i += 1) {
      const sent = await api.request('/v1/publishers/login/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com' }),
      });
      expect(sent.status).toBe(200);
    }
    const limited = await api.request('/v1/publishers/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com' }),
    });
    expect(limited.status).toBe(429);
  });

  it('requires the authenticator after password or email-code login once it is on', async () => {
    const api = app();
    await verifiedPublisher(api);
    const cookie = await loginCookie(api);

    const setup = await api.request('/v1/publishers/me/totp/setup', {
      method: 'POST',
      headers: { cookie },
    });
    expect(setup.status).toBe(200);
    const { secret } = (await setup.json()) as { secret: string; otpauthUrl: string };
    const code = generateTotpCode(secret, NOW.getTime());
    const enabled = await api.request('/v1/publishers/me/totp/confirm', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code, password: 'long-enough-password' }),
    });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toEqual({ totpEnabled: true });

    const secondSetup = await api.request('/v1/publishers/me/totp/setup', {
      method: 'POST',
      headers: { cookie },
    });
    expect(secondSetup.status).toBe(409);

    const password = await api.request('/v1/publishers/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'org@example.com', password: 'long-enough-password' }),
    });
    expect(password.status).toBe(200);
    expect(password.headers.get('set-cookie')).toBeNull();
    const challenge = (await password.json()) as { status: string; challengeToken: string };
    expect(challenge.status).toBe('totp_required');

    const wrong = await api.request('/v1/publishers/login/totp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: challenge.challengeToken, code: '000000' }),
    });
    expect(wrong.status).toBe(401);

    const totp = await api.request('/v1/publishers/login/totp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: challenge.challengeToken,
        code: generateTotpCode(secret, NOW.getTime()),
      }),
    });
    expect(totp.status).toBe(200);
    expect(totp.headers.get('set-cookie') ?? '').toContain(PUBLISHER_SESSION_COOKIE);
    expect(await totp.json()).toMatchObject({ status: 'authenticated', totpEnabled: true });

    const issued = await api.request('/v1/publishers/login/otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'org@example.com' }),
    });
    const otp = (await issued.json()) as { code: string };
    const otpLogin = await api.request('/v1/publishers/login/otp/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'org@example.com', code: otp.code }),
    });
    expect(otpLogin.status).toBe(200);
    expect(await otpLogin.json()).toMatchObject({ status: 'totp_required' });
    expect(otpLogin.headers.get('set-cookie')).toBeNull();

    const session = (totp.headers.get('set-cookie') ?? '').split(';')[0]!;
    const me = await api.request('/v1/publishers/me', { headers: { cookie: session } });
    expect(await me.json()).toMatchObject({ totpEnabled: true });

    const off = await api.request('/v1/publishers/me/totp', {
      method: 'DELETE',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({
        code: generateTotpCode(secret, NOW.getTime()),
        password: 'long-enough-password',
      }),
    });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ totpEnabled: false });
  });
});

describe('publisher login mail', () => {
  it('sends only when both Resend settings are present', () => {
    expect(createPublisherLoginMailer({})).toBeUndefined();
    expect(() => createPublisherLoginMailer({ RESEND_API_KEY: 're_test' })).toThrow(/RESEND_FROM/);
    expect(() =>
      createPublisherLoginMailer({ RESEND_FROM: 'Evently <noreply@example.com>' }),
    ).toThrow(/RESEND_API_KEY/);
    expect(
      createPublisherLoginMailer({
        RESEND_API_KEY: 're_test',
        RESEND_FROM: 'Evently <noreply@example.com>',
      }),
    ).toEqual(expect.any(Function));
  });

  it('posts the code to Resend and hides the key from errors', async () => {
    const send = createPublisherLoginMailer({
      RESEND_API_KEY: 're_secret',
      RESEND_FROM: 'Evently <noreply@example.com>',
    });
    const calls: { url: string; init: RequestInit }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ name: 'validation_error' }), { status: 422 });
    }) as typeof fetch;
    try {
      await expect(send?.({ to: 'org@example.com', code: '123456' })).rejects.toThrow(
        'publisher_login_email_failed:422:validation_error',
      );
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.resend.com/emails');
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('authorization')).toBe('Bearer re_secret');
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      from: string;
      to: string[];
      text: string;
    };
    expect(body.from).toBe('Evently <noreply@example.com>');
    expect(body.to).toEqual(['org@example.com']);
    expect(body.text).toContain('123456');
    expect(calls[0]?.url).not.toContain('re_secret');
    expect(String(calls[0]?.init.body)).not.toContain('re_secret');
  });

  it('resolves when Resend accepts the message', async () => {
    const send = createPublisherLoginMailer({
      RESEND_API_KEY: 're_secret',
      RESEND_FROM: 'Evently <noreply@example.com>',
    });
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: 'email_1' }), { status: 200 })) as typeof fetch;
    try {
      await expect(send?.({ to: 'org@example.com', code: '123456' })).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});
