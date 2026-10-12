import type { ErrorResponse } from '@local-events/contracts';
import type { Context } from 'hono';
import { LibraryError, type LibraryErrorCode } from './types';

const MESSAGES: Record<LibraryErrorCode, string> = {
  unauthorized: 'Unauthorized',
  not_found: 'Not found',
  limit_reached: 'Limit reached',
  invalid_event: 'Event is not available',
};

const STATUS: Record<LibraryErrorCode, 401 | 404 | 409> = {
  unauthorized: 401,
  not_found: 404,
  limit_reached: 409,
  invalid_event: 404,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function libraryErrorResponse(c: Context, err: unknown): any {
  if (err instanceof LibraryError) {
    const body: ErrorResponse = {
      error: { code: err.code, message: MESSAGES[err.code] },
    };
    return c.json(body, STATUS[err.code]);
  }
  throw err;
}
