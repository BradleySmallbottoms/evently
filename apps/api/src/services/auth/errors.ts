import type { ErrorResponse } from '@local-events/contracts';
import type { Context } from 'hono';
import { AuthError, type AuthErrorCode } from './types';

const MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: 'Invalid credentials',
  email_unverified: 'Email address is not verified',
  email_taken: 'Email is already registered',
  slug_taken: 'Publisher slug is already taken',
  invalid_token: 'Invalid or already used token',
  token_expired: 'Token has expired',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  invalid_pairing_code: 'Invalid or expired pairing code',
  device_link_same_user: 'Cannot link a device to the same user',
  already_member: 'Account is already a member of this publisher',
  invite_pending: 'An invite is already pending for this email',
  member_limit: 'Publisher member limit reached',
  invite_email_mismatch: 'Signed-in email does not match the invite',
};

const STATUS: Record<AuthErrorCode, 400 | 401 | 403 | 409> = {
  invalid_credentials: 401,
  email_unverified: 403,
  email_taken: 409,
  slug_taken: 409,
  invalid_token: 400,
  token_expired: 400,
  unauthorized: 401,
  forbidden: 403,
  invalid_pairing_code: 401,
  device_link_same_user: 400,
  already_member: 409,
  invite_pending: 409,
  member_limit: 403,
  invite_email_mismatch: 403,
};

/**
 * Returns an error response. Return type is intentionally loose so OpenAPI route handlers
 * (which narrow status codes per route) can `return` it from a catch block.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function authErrorResponse(c: Context, err: unknown): any {
  if (err instanceof AuthError) {
    const body: ErrorResponse = {
      error: { code: err.code, message: MESSAGES[err.code] },
    };
    return c.json(body, STATUS[err.code]);
  }
  throw err;
}
