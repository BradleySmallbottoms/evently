import type { ErrorResponse } from '@local-events/contracts';
import type { Context } from 'hono';
import { AuthError } from '../auth/types';
import { PreferenceError, type PreferenceErrorCode } from './types';

const MESSAGES: Record<PreferenceErrorCode, string> = {
  unauthorized: 'Unauthorized',
  not_found: 'Area not found',
  invalid_area: 'Invalid area geometry',
  area_limit: 'Saved area limit reached',
  unknown_category: 'One or more category ids are unknown',
  unknown_region: 'Unknown region',
};

const STATUS: Record<PreferenceErrorCode, 400 | 401 | 404 | 403> = {
  unauthorized: 401,
  not_found: 404,
  invalid_area: 400,
  area_limit: 403,
  unknown_category: 400,
  unknown_region: 400,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function preferenceErrorResponse(c: Context, err: unknown): any {
  if (err instanceof AuthError) {
    const body: ErrorResponse = {
      error: { code: err.code, message: MESSAGES.unauthorized },
    };
    return c.json(body, 401);
  }
  if (err instanceof PreferenceError) {
    const body: ErrorResponse = {
      error: { code: err.code, message: MESSAGES[err.code] },
    };
    return c.json(body, STATUS[err.code]);
  }
  throw err;
}
