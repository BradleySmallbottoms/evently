import type { ErrorResponse } from '@local-events/contracts';
import type { Context } from 'hono';
import { EventContentError, type EventContentErrorCode } from './types';

const MESSAGES: Record<EventContentErrorCode, string> = {
  unauthorized: 'Unauthorized',
  forbidden: 'Not allowed for this event',
  not_found: 'Content or event not found',
  check_in_required: 'Check in to view this content',
};

const STATUS: Record<EventContentErrorCode, 400 | 401 | 403 | 404> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  check_in_required: 403,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function eventContentErrorResponse(c: Context, err: unknown): any {
  if (err instanceof EventContentError) {
    const body: ErrorResponse = {
      error: { code: err.code, message: MESSAGES[err.code] },
    };
    return c.json(body, STATUS[err.code]);
  }
  throw err;
}
