import { describe, expect, it } from 'vitest';
import {
  canConfirmDeviceLink,
  canPublisherLogin,
  isPasswordStrongEnough,
  slugifyPublisherName,
} from '../../../packages/domain/src/auth';

describe('canPublisherLogin', () => {
  it('requires a verified email', () => {
    expect(canPublisherLogin({ emailVerifiedAt: null })).toEqual({
      ok: false,
      reason: 'email_unverified',
    });
    expect(canPublisherLogin({ emailVerifiedAt: new Date() })).toEqual({ ok: true });
  });
});

describe('slugifyPublisherName', () => {
  it('normalizes Swedish characters and punctuation', () => {
    expect(slugifyPublisherName('Café Söderhamn!')).toBe('cafe-soderhamn');
  });
  it('falls back when empty', () => {
    expect(slugifyPublisherName('!!!')).toBe('publisher');
  });
});

describe('isPasswordStrongEnough', () => {
  it('requires at least 10 characters', () => {
    expect(isPasswordStrongEnough('short')).toBe(false);
    expect(isPasswordStrongEnough('long-enough')).toBe(true);
  });
});

describe('canConfirmDeviceLink', () => {
  it('rejects linking a device to the same user', () => {
    expect(
      canConfirmDeviceLink({
        pendingUserId: 'user-a',
        confirmingUserId: 'user-a',
      }),
    ).toEqual({ ok: false, reason: 'same_user' });
  });
  it('allows linking onto a different user', () => {
    expect(
      canConfirmDeviceLink({
        pendingUserId: 'user-new',
        confirmingUserId: 'user-old',
      }),
    ).toEqual({ ok: true });
  });
});
