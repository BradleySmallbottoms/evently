import { describe, expect, it } from 'vitest';

import { isRejectedIdentity } from '../../../apps/mobile/src/lib/identity-check';

function apiError(status: number, code?: string): Error {
  const err = new Error('api');
  err.name = 'ApiError';
  return Object.assign(err, { status, code });
}

describe('isRejectedIdentity', () => {
  it('treats a missing or revoked device credential as rejected', () => {
    expect(isRejectedIdentity(apiError(401, 'invalid_credentials'))).toBe(true);
    expect(isRejectedIdentity(apiError(401))).toBe(true);
  });

  it('treats a banned user as rejected', () => {
    expect(isRejectedIdentity(apiError(403, 'user_banned'))).toBe(true);
  });

  it('leaves network and other API failures alone', () => {
    expect(isRejectedIdentity(new TypeError('Network request failed'))).toBe(false);
    expect(isRejectedIdentity(apiError(500))).toBe(false);
    expect(isRejectedIdentity(apiError(403, 'forbidden'))).toBe(false);
  });
});
