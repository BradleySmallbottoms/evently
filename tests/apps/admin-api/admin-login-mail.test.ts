import { describe, expect, it } from 'vitest';
import { createAdminLoginMailer } from '../../../apps/admin-api/src/services/auth/mail';

describe('admin login mail', () => {
  it('sends only when both Resend settings are present', () => {
    expect(createAdminLoginMailer({})).toBeUndefined();
    expect(() => createAdminLoginMailer({ RESEND_API_KEY: 're_test' })).toThrow(/RESEND_FROM/);
    expect(() => createAdminLoginMailer({ RESEND_FROM: 'Evently <noreply@example.com>' })).toThrow(
      /RESEND_API_KEY/,
    );
    expect(
      createAdminLoginMailer({
        RESEND_API_KEY: 're_test',
        RESEND_FROM: 'Evently <noreply@example.com>',
      }),
    ).toEqual(expect.any(Function));
  });

  it('posts the code to Resend and hides the key from errors', async () => {
    const send = createAdminLoginMailer({
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
      await expect(send?.({ to: 'admin@example.com', code: '123456' })).rejects.toThrow(
        'admin_login_email_failed:422:validation_error',
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
    expect(body.to).toEqual(['admin@example.com']);
    expect(body.text).toContain('123456');
    expect(calls[0]?.url).not.toContain('re_secret');
    expect(String(calls[0]?.init.body)).not.toContain('re_secret');
  });

  it('resolves when Resend accepts the message', async () => {
    const send = createAdminLoginMailer({
      RESEND_API_KEY: 're_secret',
      RESEND_FROM: 'Evently <noreply@example.com>',
    });
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: 'email_1' }), { status: 200 })) as typeof fetch;
    try {
      await expect(send?.({ to: 'admin@example.com', code: '123456' })).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});
