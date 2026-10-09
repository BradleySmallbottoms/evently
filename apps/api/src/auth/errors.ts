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
};

const STATUS: Record<AuthErrorCode, 400 | 401 | 403 | 409> = {
  invalid_credentials: 401,
  email_unverified: 403,
  email_taken: 409,
  slug_taken: 409,
  invalid_token: 400,
  token_expired: 400,
  unauthorized: 401,
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
