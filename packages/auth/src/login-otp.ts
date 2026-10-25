import { randomInt, timingSafeEqual } from 'node:crypto';
import { hashToken } from './hash';

/** Single-use admin email code lifetime. */
export const ADMIN_LOGIN_OTP_TTL_SECONDS = 10 * 60;
/** Wrong guesses against the current code before it is burned. */
export const ADMIN_LOGIN_OTP_MAX_ATTEMPTS = 5;
/** How many codes one email may request in a window. Unknown emails count too. */
export const ADMIN_LOGIN_OTP_MAX_REQUESTS = 5;
export const ADMIN_LOGIN_OTP_WINDOW_SECONDS = 15 * 60;
/** `email_verification_tokens.purpose` for an admin sign-in code. */
export const ADMIN_LOGIN_OTP_PURPOSE = 'admin_login_otp';

/** Six-digit code. Stored hashed; the raw value is shown or mailed once. */
export function generateLoginOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** SHA-256 of pepper + code, so a dump of the hash column is not a 6-digit rainbow table. */
export function loginOtpHash(code: string, pepper: string): string {
  return hashToken(`${pepper}:${code}`);
}

export function loginOtpMatches(code: string, pepper: string, tokenHash: string): boolean {
  const digest = Buffer.from(loginOtpHash(code, pepper), 'hex');
  const stored = Buffer.from(tokenHash, 'hex');
  return digest.length === stored.length && digest.length > 0 && timingSafeEqual(digest, stored);
}

export type LoginOtpRecord = {
  id: string;
  tokenHash: string;
  expiresAt: Date;
  attempts: number;
};

export type LoginOtpConfirmDecision =
  | { ok: true; id: string }
  | {
      ok: false;
      code: 'invalid_otp' | 'otp_expired';
      burnIds: string[];
      attempts: { id: string; attempts: number }[];
    };

/**
 * Match a submitted code against the unused codes for one admin.
 * A miss spends an attempt on each code that is still current. At the attempt
 * cap those codes are burned. An expired match is reported on its own.
 */
export function decideLoginOtpConfirm(input: {
  code: string;
  pepper: string;
  records: LoginOtpRecord[];
  now: Date;
  maxAttempts: number;
}): LoginOtpConfirmDecision {
  const match = input.records.find((record) =>
    loginOtpMatches(input.code, input.pepper, record.tokenHash),
  );
  if (!match) {
    const attempts: { id: string; attempts: number }[] = [];
    const burnIds: string[] = [];
    for (const record of input.records) {
      if (record.expiresAt <= input.now) continue;
      const next = record.attempts + 1;
      attempts.push({ id: record.id, attempts: next });
      if (next >= input.maxAttempts) burnIds.push(record.id);
    }
    return { ok: false, code: 'invalid_otp', burnIds, attempts };
  }
  if (match.expiresAt <= input.now) {
    return { ok: false, code: 'otp_expired', burnIds: [], attempts: [] };
  }
  if (match.attempts >= input.maxAttempts) {
    return { ok: false, code: 'invalid_otp', burnIds: [match.id], attempts: [] };
  }
  return { ok: true, id: match.id };
}
