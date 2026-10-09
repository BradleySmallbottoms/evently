import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, throwIfError } from './index';

describe('createApiClient', () => {
  it('builds a client with the given base URL', () => {
    const client = createApiClient({ baseUrl: 'http://localhost:3000' });
    expect(typeof client.GET).toBe('function');
    expect(typeof client.POST).toBe('function');
  });
});

describe('throwIfError', () => {
  it('returns data on success', () => {
    expect(
      throwIfError({
        data: { ok: true },
        response: new Response(null, { status: 200 }),
      }),
    ).toEqual({ ok: true });
  });

  it('throws ApiError with code from the body', () => {
    try {
      throwIfError({
        error: { error: { code: 'email_unverified', message: 'Email address is not verified' } },
        response: new Response(null, { status: 403 }),
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ status: 403, code: 'email_unverified' });
    }
  });
});
