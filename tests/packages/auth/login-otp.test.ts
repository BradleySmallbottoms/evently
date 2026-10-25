import { describe, expect, it } from 'vitest';
import {
  ADMIN_LOGIN_OTP_MAX_ATTEMPTS,
  decideLoginOtpConfirm,
  generateLoginOtp,
  hashToken,
  loginOtpHash,
} from '../../../packages/auth/src/index';

const pepper = 'test-pepper';

describe('admin login otp', () => {
  it('generates a 6-digit code', () => {
    expect(generateLoginOtp()).toMatch(/^\d{6}$/);
  });

  it('does not store the raw code hash', () => {
    expect(loginOtpHash('123456', pepper)).not.toBe(hashToken('123456'));
  });

  it('accepts the matching current code and burns a code after the attempt cap', () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    const code = '123456';
    const records = [
      {
        id: 'otp-1',
        tokenHash: loginOtpHash(code, pepper),
        expiresAt: new Date(now.getTime() + 60_000),
        attempts: 0,
      },
    ];
    expect(
      decideLoginOtpConfirm({
        code,
        pepper,
        records,
        now,
        maxAttempts: ADMIN_LOGIN_OTP_MAX_ATTEMPTS,
      }),
    ).toEqual({ ok: true, id: 'otp-1' });

    let attempts = 0;
    for (let i = 0; i < ADMIN_LOGIN_OTP_MAX_ATTEMPTS; i += 1) {
      const decision = decideLoginOtpConfirm({
        code: '000000',
        pepper,
        records: [{ ...records[0]!, attempts }],
        now,
        maxAttempts: ADMIN_LOGIN_OTP_MAX_ATTEMPTS,
      });
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        attempts = decision.attempts[0]?.attempts ?? attempts;
        if (i < ADMIN_LOGIN_OTP_MAX_ATTEMPTS - 1) expect(decision.burnIds).toEqual([]);
        else expect(decision.burnIds).toEqual(['otp-1']);
      }
    }
  });

  it('reports an expired match without spending attempts', () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    const decision = decideLoginOtpConfirm({
      code: '123456',
      pepper,
      records: [
        {
          id: 'otp-1',
          tokenHash: loginOtpHash('123456', pepper),
          expiresAt: new Date(now.getTime() - 1000),
          attempts: 0,
        },
      ],
      now,
      maxAttempts: ADMIN_LOGIN_OTP_MAX_ATTEMPTS,
    });
    expect(decision).toEqual({ ok: false, code: 'otp_expired', burnIds: [], attempts: [] });
  });
});
