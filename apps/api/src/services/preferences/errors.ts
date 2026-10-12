import type { ErrorResponse } from '@local-events/contracts';
import type { Context } from 'hono';
import { AuthError } from '../auth/types';
import { authErrorResponse } from '../auth/errors';
import { PreferenceError, type PreferenceErrorCode } from './types';

const MESSAGES: Record<PreferenceErrorCode, string> = {
  unauthorized: 'Unauthorized',
  not_found: 'Area not found',
  invalid_area: 'Invalid area geometry',
  area_limit: 'Saved area limit reached',
  unknown_tag: 'One or more tag ids are unknown',
  unknown_region: 'Unknown region',
  invalid_display_name: 'Display name must be 2–40 characters',
  name_required: 'Display name is required for a named profile',
};

const STATUS: Record<PreferenceErrorCode, 400 | 401 | 404 | 403> = {
  unauthorized: 401,
  not_found: 404,
  invalid_area: 400,
  area_limit: 403,
  unknown_tag: 400,
  unknown_region: 400,
  invalid_display_name: 400,
  name_required: 400,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function preferenceErrorResponse(c: Context, err: unknown): any {
  if (err instanceof AuthError) {
    return authErrorResponse(c, err);
  }
  if (err instanceof PreferenceError) {
    const body: ErrorResponse = {
      error: { code: err.code, message: MESSAGES[err.code] },
    };
    return c.json(body, STATUS[err.code]);
  }
  throw err;
}
