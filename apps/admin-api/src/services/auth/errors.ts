import type { ErrorResponse } from '@local-events/contracts';
import type { Context } from 'hono';
import { AdminAuthError, type AdminAuthErrorCode } from './types';

const MESSAGES: Record<AdminAuthErrorCode, string> = {
  unauthorized: 'Unauthorized',
  invalid_credentials: 'Invalid email or password',
  invalid_totp: 'Invalid authenticator code',
  challenge_expired: 'Login challenge expired; start again',
  invalid_otp: 'Invalid code',
  otp_expired: 'Code expired; request a new one',
  otp_rate_limited: 'Too many code requests; try again later',
};

const STATUS: Record<AdminAuthErrorCode, 401 | 429> = {
  unauthorized: 401,
  invalid_credentials: 401,
  invalid_totp: 401,
  challenge_expired: 401,
  invalid_otp: 401,
  otp_expired: 401,
  otp_rate_limited: 429,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adminAuthErrorResponse(c: Context, err: unknown): any {
  if (err instanceof AdminAuthError) {
    const body: ErrorResponse = {
      error: { code: err.code, message: MESSAGES[err.code] },
    };
    return c.json(body, STATUS[err.code]);
  }
  throw err;
}
