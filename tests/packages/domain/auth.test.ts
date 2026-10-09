import { describe, expect, it } from 'vitest';
import {
  canConfirmDeviceLink,
  canManagePublisherOrg,
  canPublisherLogin,
  isPasswordStrongEnough,
  slugifyPublisherName,
} from '../../../packages/domain/src/auth';
import { canInviteAnotherMember, LAUNCH_PLAN } from '../../../packages/domain/src/entitlements';

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

describe('canManagePublisherOrg', () => {
  it('is owner-only', () => {
    expect(canManagePublisherOrg('owner')).toBe(true);
    expect(canManagePublisherOrg('editor')).toBe(false);
  });
});

describe('canInviteAnotherMember', () => {
  it('allows unlimited members on the launch plan', () => {
    expect(canInviteAnotherMember(LAUNCH_PLAN, 100)).toBe(true);
  });
  it('respects a finite maxMembers cap', () => {
    expect(canInviteAnotherMember({ ...LAUNCH_PLAN, maxMembers: 2 }, 2)).toBe(false);
    expect(canInviteAnotherMember({ ...LAUNCH_PLAN, maxMembers: 2 }, 1)).toBe(true);
  });
});
