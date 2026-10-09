import type { ErrorResponse } from '@local-events/contracts';
import type { Context } from 'hono';
import { EventError, type EventErrorCode } from './types';

const MESSAGES: Record<EventErrorCode, string> = {
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  not_found: 'Not found',
  invalid_event: 'Invalid event',
  location_required: 'Physical events require a location',
  online_url_required: 'Digital events require an online URL',
  cannot_edit: 'Event cannot be edited in its current status',
  cannot_publish: 'Event cannot be published in its current status',
  cannot_cancel: 'Event cannot be cancelled in its current status',
  limit_reached: 'Monthly event publish limit reached',
};

const STATUS: Record<EventErrorCode, 400 | 401 | 403 | 404> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_event: 400,
  location_required: 400,
  online_url_required: 400,
  cannot_edit: 400,
  cannot_publish: 400,
  cannot_cancel: 400,
  limit_reached: 403,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function eventErrorResponse(c: Context, err: unknown): any {
  if (err instanceof EventError) {
    const body: ErrorResponse = {
      error: { code: err.code, message: MESSAGES[err.code] },
    };
    return c.json(body, STATUS[err.code]);
  }
  throw err;
}
