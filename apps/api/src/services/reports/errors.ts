import type { ErrorResponse } from '@local-events/contracts';
import type { Context } from 'hono';
import { ReportError, type ReportErrorCode } from './types';

const MESSAGES: Record<ReportErrorCode, string> = {
  unauthorized: 'Unauthorized',
  forbidden: 'Not allowed',
  not_found: 'Event not found',
};

const STATUS: Record<ReportErrorCode, 401 | 403 | 404> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reportErrorResponse(c: Context, err: unknown): any {
  if (err instanceof ReportError) {
    const body: ErrorResponse = {
      error: { code: err.code, message: MESSAGES[err.code] },
    };
    return c.json(body, STATUS[err.code]);
  }
  throw err;
}
