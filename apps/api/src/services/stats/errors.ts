import type { ErrorResponse } from '@local-events/contracts';
import type { Context } from 'hono';
import { AuthError } from '../auth/types';
import { StatsError, type StatsErrorCode } from './types';

const MESSAGES: Record<StatsErrorCode, string> = {
  unauthorized: 'Unauthorized',
  not_found: 'Not found',
  forbidden: 'Forbidden',
  bad_request: 'Bad request',
};

const STATUS: Record<StatsErrorCode, 400 | 401 | 403 | 404> = {
  unauthorized: 401,
  not_found: 404,
  forbidden: 403,
  bad_request: 400,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function statsErrorResponse(c: Context, err: unknown): any {
  if (err instanceof AuthError) {
    const body: ErrorResponse = {
      error: { code: 'unauthorized', message: MESSAGES.unauthorized },
    };
    return c.json(body, 401);
  }
  if (err instanceof StatsError) {
    const body: ErrorResponse = {
      error: { code: err.code, message: MESSAGES[err.code] },
    };
    return c.json(body, STATUS[err.code]);
  }
  throw err;
}
